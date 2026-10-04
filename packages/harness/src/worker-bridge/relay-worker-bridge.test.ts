import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RelayAdapter } from "../adapter/relay-adapter.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentRelayExecutionAdapter } from "../adapter/agent-relay-adapter.js";
import type { ExecutionRequest } from "../adapter/types.js";

import { createBashCliRunner } from "./bash-cli-runner.js";
import type { CliRunner } from "./cli-runner.js";
import {
  createRelayWorkerBridge,
  type RelayWorkerBridgeHandle,
} from "./relay-worker-bridge.js";

const CHANNEL_ID = "wf-harness-worker-bridge";
const WORKER_NAME = "harness-bridge-worker";
const ORCHESTRATOR_NAME = "agent-assistant";

type Harness = {
  cwd: string;
  relay: RelayAdapter;
  bridge: RelayWorkerBridgeHandle;
};

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function startHarness(scriptBody: string): Promise<Harness> {
  const cwd = mkdtempSync(join(tmpdir(), "harness-worker-bridge-"));
  const relay = new RelayAdapter({ cwd, channels: [CHANNEL_ID], shutdownTimeoutMs: SHUTDOWN_BUDGET_MS });
  await relay.start();

  // Pre-register the orchestrator name so the bridge can reply.
  const orchestrator = await relay.spawn({
    name: ORCHESTRATOR_NAME,
    cli: "bash",
    task: "cat >/dev/null",
    includeWorkflowConventions: false,
  });
  if (!orchestrator.success) {
    throw new Error(
      `Failed to register orchestrator: ${orchestrator.error ?? "unknown"}`,
    );
  }

  const runner = createBashCliRunner({ script: scriptBody });
  const bridge = await createRelayWorkerBridge({
    relay,
    channelId: CHANNEL_ID,
    workerName: WORKER_NAME,
    runner,
    cwd,
    timeoutMs: 10_000,
    logger: silentLogger,
  });

  return { cwd, relay, bridge };
}

async function startHarnessWithRunner(runner: CliRunner): Promise<Harness> {
  const cwd = mkdtempSync(join(tmpdir(), "harness-worker-bridge-"));
  const relay = new RelayAdapter({ cwd, channels: [CHANNEL_ID], shutdownTimeoutMs: SHUTDOWN_BUDGET_MS });
  await relay.start();

  const orchestrator = await relay.spawn({
    name: ORCHESTRATOR_NAME,
    cli: "bash",
    task: "cat >/dev/null",
    includeWorkflowConventions: false,
  });
  if (!orchestrator.success) {
    throw new Error(
      `Failed to register orchestrator: ${orchestrator.error ?? "unknown"}`,
    );
  }

  const bridge = await createRelayWorkerBridge({
    relay,
    channelId: CHANNEL_ID,
    workerName: WORKER_NAME,
    runner,
    cwd,
    timeoutMs: 10_000,
    logger: silentLogger,
  });

  return { cwd, relay, bridge };
}

// Teardown budget, derived from CI measurements of the 12.x broker:
// release() waits for the hosted fleet to confirm owned-identity cleanup
// (~5-8.5s per agent, sometimes "cleanup unconfirmed; retry retained") and
// shutdown() took ~1.8s. Agents are released concurrently so the hosted
// identities are still cleaned up, but the wait is bounded; RelayAdapter
// bounds shutdown itself (shutdownTimeoutMs, then SIGKILL).
const RELEASE_BUDGET_MS = 10_000;
const SHUTDOWN_BUDGET_MS = 5_000;
const TEARDOWN_TIMEOUT_MS = RELEASE_BUDGET_MS + SHUTDOWN_BUDGET_MS + 2_000;

async function releaseAll(relay: RelayAdapter, names: readonly string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(names.map((name) => relay.release(name))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RELEASE_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
}

async function teardown(harness: Harness | undefined): Promise<void> {
  if (!harness) return;
  harness.bridge.dispose();
  await releaseAll(harness.relay, [WORKER_NAME, ORCHESTRATOR_NAME]);
  await harness.relay.shutdown().catch(() => {});
  rmSync(harness.cwd, { recursive: true, force: true });
}

describe("createRelayWorkerBridge integration", () => {
  let harness: Harness | undefined;

  beforeEach(() => {
    harness = undefined;
  });

  afterEach(async () => {
    await teardown(harness);
    harness = undefined;
  }, TEARDOWN_TIMEOUT_MS);

  it(
    "round-trips a real ExecutionRequest through the broker + bash runner",
    async () => {
      harness = await startHarness(
        'read -d "" prompt; echo "bash echoed: ${prompt:0:40}"',
      );

      const adapter = createAgentRelayExecutionAdapter({
        cwd: harness.cwd,
        channelId: CHANNEL_ID,
        workerName: WORKER_NAME,
        orchestratorName: ORCHESTRATOR_NAME,
        spawnWorker: { enabled: false, cli: "bash" },
        timeoutMs: 25_000,
        relay: harness.relay,
      });

      const request: ExecutionRequest = {
        assistantId: "harness-bridge-test",
        turnId: "turn-bridge-1",
        threadId: "thread-bridge-1",
        message: {
          id: "m-bridge-1",
          text: "hello from bridge test",
          receivedAt: new Date().toISOString(),
        },
        instructions: {
          systemPrompt: "You are a bridge smoke-test responder.",
        },
      };

      const result = await adapter.execute(request);

      expect(result.status).toBe("completed");
      expect(result.output?.text).toMatch(/^bash echoed: /);
      expect(result.metadata?.relay).toMatchObject({
        channelId: CHANNEL_ID,
        target: WORKER_NAME,
        threadId: "thread-bridge-1",
      });
    },
    45_000,
  );

  it(
    "surfaces a runner-level failure as a failed ExecutionResult",
    async () => {
      harness = await startHarness('echo "boom" >&2; exit 7');

      const adapter = createAgentRelayExecutionAdapter({
        cwd: harness.cwd,
        channelId: CHANNEL_ID,
        workerName: WORKER_NAME,
        orchestratorName: ORCHESTRATOR_NAME,
        spawnWorker: { enabled: false, cli: "bash" },
        timeoutMs: 25_000,
        relay: harness.relay,
      });

      const result = await adapter.execute({
        assistantId: "harness-bridge-test",
        turnId: "turn-bridge-fail",
        threadId: "thread-bridge-fail",
        message: {
          id: "m-bridge-fail",
          text: "trigger failure",
          receivedAt: new Date().toISOString(),
        },
        instructions: { systemPrompt: "sys" },
      });

      expect(result.status).toBe("failed");
      expect(result.output).toBeUndefined();
    },
    45_000,
  );

  it(
    "catches a throwing runner and still responds with a failed ExecutionResult",
    async () => {
      const throwingRunner: CliRunner = {
        id: "throwing-test-runner",
        async run() {
          throw new Error("synthetic runner crash");
        },
      };
      harness = await startHarnessWithRunner(throwingRunner);

      const adapter = createAgentRelayExecutionAdapter({
        cwd: harness.cwd,
        channelId: CHANNEL_ID,
        workerName: WORKER_NAME,
        orchestratorName: ORCHESTRATOR_NAME,
        spawnWorker: { enabled: false, cli: "bash" },
        timeoutMs: 15_000,
        relay: harness.relay,
      });

      const result = await adapter.execute({
        assistantId: "harness-bridge-test",
        turnId: "turn-bridge-throw",
        threadId: "thread-bridge-throw",
        message: {
          id: "m-bridge-throw",
          text: "this will throw in the runner",
          receivedAt: new Date().toISOString(),
        },
        instructions: { systemPrompt: "sys" },
      });

      // The bridge must translate the rejected promise into a typed
      // ExecutionResult so the orchestrator doesn't wait for a full
      // adapter timeout.
      expect(result.status).toBe("failed");
      expect(result.error?.message ?? "").toContain("synthetic runner crash");
      expect(result.error?.message ?? "").toContain("throwing-test-runner");
    },
    // Same budget as the sibling real-broker tests: broker startup plus
    // teardown alone runs ~30s on CI runners.
    45_000,
  );
});
