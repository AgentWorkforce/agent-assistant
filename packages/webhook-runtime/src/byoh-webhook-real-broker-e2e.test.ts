import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RelayAdapter, type BrokerEvent } from "@agent-relay/sdk";
import {
  AGENT_RELAY_EXECUTION_REQUEST_TYPE,
  AGENT_RELAY_EXECUTION_RESULT_TYPE,
  createAgentRelayExecutionAdapter,
  type AgentRelayExecutionRequestMessage,
} from "@agent-assistant/harness/agent-relay";
import type { ExecutionRequest, ExecutionResult } from "@agent-assistant/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHANNEL_ID = "wf-webhook-byoh-real-broker";
const WORKER_NAME = "test-worker";
const ORCHESTRATOR_NAME = "agent-assistant";

type WorkerHarness = {
  workerRelay: RelayAdapter;
  cwd: string;
  spawnedAgents: string[];
  received: AgentRelayExecutionRequestMessage[];
  unsubscribe: () => void;
};

// The broker rejects sendMessage to an unregistered agent name
// (Agent "<name>" not found). spawning a no-op bash process with
// `cat >/dev/null` registers the name as an agent and keeps a keepalive
// PID alive so the broker routes messages to it. The test's relay
// onEvent listener still sees those inbound events and handles the
// real logic; the bash process just absorbs routed delivery.
async function registerAgent(relay: RelayAdapter, name: string): Promise<void> {
  const result = await relay.spawn({
    name,
    cli: "bash",
    task: "cat >/dev/null",
    includeWorkflowConventions: false,
  });
  if (!result.success) {
    throw new Error(`Failed to pre-spawn agent "${name}": ${result.error ?? "unknown"}`);
  }
}

async function startWorkerHarness(
  handler: (request: AgentRelayExecutionRequestMessage) => ExecutionResult,
  agentNames: readonly string[] = [WORKER_NAME, ORCHESTRATOR_NAME],
): Promise<WorkerHarness> {
  const cwd = mkdtempSync(join(tmpdir(), "byoh-real-broker-"));
  const workerRelay = new RelayAdapter({ cwd, channels: [CHANNEL_ID] });
  await workerRelay.start();

  const spawnedAgents: string[] = [];
  for (const name of agentNames) {
    await registerAgent(workerRelay, name);
    spawnedAgents.push(name);
  }

  const received: AgentRelayExecutionRequestMessage[] = [];

  const unsubscribe = workerRelay.onEvent((event: BrokerEvent) => {
    if (event.kind !== "relay_inbound") return;
    if (event.target !== WORKER_NAME) return;

    let parsed: AgentRelayExecutionRequestMessage;
    try {
      parsed = JSON.parse(event.body) as AgentRelayExecutionRequestMessage;
    } catch {
      return;
    }
    if (parsed.type !== AGENT_RELAY_EXECUTION_REQUEST_TYPE) return;

    received.push(parsed);

    const executionResult = handler(parsed);

    void workerRelay
      .sendMessage({
        to: parsed.replyTo.agentId,
        from: WORKER_NAME,
        threadId: parsed.threadId,
        text: JSON.stringify({
          type: AGENT_RELAY_EXECUTION_RESULT_TYPE,
          turnId: parsed.turnId,
          threadId: parsed.threadId,
          executionResult,
        }),
      })
      .catch(() => {
        // Adapter timeout will surface the failure.
      });
  });

  return { workerRelay, cwd, spawnedAgents, received, unsubscribe };
}

async function teardown(harness: WorkerHarness | undefined): Promise<void> {
  if (!harness) return;
  harness.unsubscribe();
  for (const name of harness.spawnedAgents) {
    await harness.workerRelay.release(name).catch(() => {});
  }
  await harness.workerRelay.shutdown().catch(() => {});
  rmSync(harness.cwd, { recursive: true, force: true });
}

describe("byoh real-broker E2E", () => {
  let harness: WorkerHarness | undefined;

  beforeEach(() => {
    harness = undefined;
  });

  afterEach(async () => {
    await teardown(harness);
    harness = undefined;
  });

  it(
    "round-trips an ExecutionRequest through the real agent-relay broker and returns a typed ExecutionResult",
    async () => {
      harness = await startWorkerHarness(() => ({
        backendId: "test-worker",
        status: "completed",
        output: { text: "real-broker test response" },
      }));

      // The adapter constructs its own RelayAdapter pointed at the same cwd,
      // so it shares the broker subprocess with the worker but uses a
      // separate transport identity (avoids broker loopback quirks where
      // same-relay send/receive shows a generated `from`).
      // Inject the harness relay so the adapter's listener sees its own
      // sends (same-relay loopback preserves the explicit `from` field;
      // cross-relay deliveries present a broker-generated auto-name
      // instead, which would break the adapter's `inbound.from === workerName`
      // filter).
      const adapter = createAgentRelayExecutionAdapter({
        cwd: harness.cwd,
        channelId: CHANNEL_ID,
        workerName: WORKER_NAME,
        orchestratorName: ORCHESTRATOR_NAME,
        spawnWorker: { enabled: false, cli: "claude" },
        timeoutMs: 30_000,
        shutdownAfterExecute: false,
        relay: harness.workerRelay,
      });

      const request: ExecutionRequest = {
        assistantId: "slack-specialist",
        turnId: "turn-rb-1",
        threadId: "thread-rb-1",
        message: {
          id: "m-rb-1",
          text: "hello via real broker",
          receivedAt: new Date().toISOString(),
        },
        instructions: {
          systemPrompt: "Relay-hosted specialist responding via real broker.",
        },
      };

      const result = await adapter.execute(request);

      expect(result.status).toBe("completed");
      expect(result.output?.text).toBe("real-broker test response");
      expect(result.metadata?.relay).toMatchObject({
        channelId: CHANNEL_ID,
        target: WORKER_NAME,
        threadId: "thread-rb-1",
      });

      expect(harness.received).toHaveLength(1);
      const [captured] = harness.received;
      expect(captured.type).toBe(AGENT_RELAY_EXECUTION_REQUEST_TYPE);
      expect(captured.turnId).toBe("turn-rb-1");
      expect(captured.threadId).toBe("thread-rb-1");
      expect(captured.replyTo.agentId).toBe(ORCHESTRATOR_NAME);
      expect(captured.replyTo.channelId).toBe(CHANNEL_ID);
      expect(captured.request.assistantId).toBe("slack-specialist");
      expect(captured.request.message.text).toBe("hello via real broker");
      expect(captured.request.instructions.systemPrompt).toBeDefined();
    },
    45_000,
  );

  it(
    "times out with a retryable error when no worker responds",
    async () => {
      // Pre-spawn the target so sendMessage succeeds at the broker level;
      // the harness listener filters on WORKER_NAME so messages sent to
      // silent-worker pass through without a response, producing a real
      // adapter timeout (not a backend_execution_error from a 404).
      harness = await startWorkerHarness(
        () => {
          throw new Error("should not be invoked — listener filter skips silent-worker");
        },
        [WORKER_NAME, ORCHESTRATOR_NAME, "silent-worker"],
      );

      const adapter = createAgentRelayExecutionAdapter({
        cwd: harness.cwd,
        channelId: CHANNEL_ID,
        workerName: "silent-worker",
        orchestratorName: ORCHESTRATOR_NAME,
        spawnWorker: { enabled: false, cli: "claude" },
        timeoutMs: 1_500,
        shutdownAfterExecute: false,
        relay: harness.workerRelay,
      });

      const result = await adapter.execute({
        assistantId: "slack-specialist",
        turnId: "turn-rb-timeout",
        threadId: "thread-rb-timeout",
        message: {
          id: "m-rb-timeout",
          text: "no worker listening",
          receivedAt: new Date().toISOString(),
        },
        instructions: {
          systemPrompt: "Relay-hosted specialist responding via real broker.",
        },
      });

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      expect(result.error?.retryable).toBe(true);
      expect(harness.received).toHaveLength(0);
    },
    15_000,
  );
});
