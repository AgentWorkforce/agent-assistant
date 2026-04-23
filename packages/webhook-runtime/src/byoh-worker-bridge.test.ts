import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RelayAdapter } from "@agent-relay/sdk";
import { createAgentRelayExecutionAdapter } from "@agent-assistant/harness/agent-relay";
import type { ExecutionRequest } from "@agent-assistant/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runWorkerBridge,
  type WorkerBridgeHandle,
  type WorkerBridgeOptions,
} from "../examples/byoh-worker.js";

const CHANNEL_ID = "wf-byoh-worker-smoke";
const WORKER_NAME = "byoh-worker-smoke";
const ORCHESTRATOR_NAME = "agent-assistant";

type Harness = {
  cwd: string;
  relay: RelayAdapter;
  bridge: WorkerBridgeHandle;
};

async function startHarness(cliArgsScript: string): Promise<Harness> {
  const cwd = mkdtempSync(join(tmpdir(), "byoh-worker-smoke-"));
  const relay = new RelayAdapter({ cwd, channels: [CHANNEL_ID] });
  await relay.start();

  // Register orchestrator so the worker can reply to it.
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

  const opts: WorkerBridgeOptions = {
    cli: "bash",
    cliArgs: [cliArgsScript],
    channel: CHANNEL_ID,
    workerName: WORKER_NAME,
    cwd,
    timeoutMs: 10_000,
  };

  const bridge = await runWorkerBridge(relay, opts);
  return { cwd, relay, bridge };
}

async function teardown(harness: Harness | undefined): Promise<void> {
  if (!harness) return;
  harness.bridge.dispose();
  await harness.relay.release(WORKER_NAME).catch(() => {});
  await harness.relay.release(ORCHESTRATOR_NAME).catch(() => {});
  await harness.relay.shutdown().catch(() => {});
  rmSync(harness.cwd, { recursive: true, force: true });
}

describe("byoh-worker bridge smoke test (bash stub)", () => {
  let harness: Harness | undefined;

  beforeEach(() => {
    harness = undefined;
  });

  afterEach(async () => {
    await teardown(harness);
    harness = undefined;
  });

  it(
    "receives an ExecutionRequest via real broker, invokes bash stub, returns ExecutionResult",
    async () => {
      harness = await startHarness('read -d "" prompt; echo "stub echoed: ${prompt:0:40}"');

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
        assistantId: "smoke-test",
        turnId: "turn-smoke-1",
        threadId: "thread-smoke-1",
        message: {
          id: "m-smoke-1",
          text: "hello from smoke test",
          receivedAt: new Date().toISOString(),
        },
        instructions: {
          systemPrompt: "You are a smoke-test responder.",
        },
      };

      const result = await adapter.execute(request);

      expect(result.status).toBe("completed");
      expect(result.output?.text).toMatch(/^stub echoed: /);
      expect(result.metadata?.relay).toMatchObject({
        channelId: CHANNEL_ID,
        target: WORKER_NAME,
        threadId: "thread-smoke-1",
      });
    },
    45_000,
  );

  it(
    "reports backend_execution_error when the CLI exits non-zero",
    async () => {
      harness = await startHarness('echo "failing stub" >&2; exit 3');

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
        assistantId: "smoke-test",
        turnId: "turn-smoke-fail",
        threadId: "thread-smoke-fail",
        message: {
          id: "m-smoke-fail",
          text: "this should fail",
          receivedAt: new Date().toISOString(),
        },
        instructions: { systemPrompt: "sys" },
      });

      expect(result.status).toBe("failed");
      // The worker replied with a properly shaped ExecutionResult whose
      // own status was 'failed'. The adapter surfaces that via its own
      // error field on the outer result.
      expect(result.output).toBeUndefined();
      expect(result.error?.code ?? "").toMatch(/backend_execution_error|execution_failed/);
    },
    45_000,
  );
});
