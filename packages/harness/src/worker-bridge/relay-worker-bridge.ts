import type { RelayAdapter, BrokerEvent } from "@agent-relay/sdk";

import {
  AGENT_RELAY_EXECUTION_REQUEST_TYPE,
  AGENT_RELAY_EXECUTION_RESULT_TYPE,
  type AgentRelayExecutionRequestMessage,
} from "../adapter/agent-relay-adapter.js";
import type { ExecutionResult } from "../adapter/types.js";

import type { CliRunner } from "./cli-runner.js";

export interface RelayWorkerBridgeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface RelayWorkerBridgeConfig {
  /**
   * A started RelayAdapter. Caller owns its lifecycle — the bridge does
   * NOT call relay.shutdown() on dispose. This enables both the single-
   * process pattern (tests, embedded) and the long-running worker process
   * pattern (CLI entrypoint).
   */
  relay: RelayAdapter;
  channelId: string;
  /** Agent name the bridge registers as on the broker. */
  workerName: string;
  runner: CliRunner;
  /** Per-invocation timeout forwarded to the runner. */
  timeoutMs?: number;
  /** Default model for the runner. Per-request metadata could override. */
  model?: string;
  /** Working directory for the runner. */
  cwd?: string;
  /** Environment for the runner. Defaults to inheriting process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * If true, the bridge registers the worker name with the broker via
   * relay.spawn(bash keepalive). Set to false if the caller has already
   * registered the name (e.g., tests injecting a pre-spawned agent).
   * Default: true.
   */
  registerWorker?: boolean;
  logger?: RelayWorkerBridgeLogger;
}

export interface RelayWorkerBridgeHandle {
  /** Unsubscribe from relay events. Does NOT shut down the relay. */
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

const consoleLogger: RelayWorkerBridgeLogger = {
  info(message, context) {
    console.info(`[byoh-worker] ${message}`, context ?? "");
  },
  warn(message, context) {
    console.warn(`[byoh-worker] ${message}`, context ?? "");
  },
  error(message, context) {
    console.error(`[byoh-worker] ${message}`, context ?? "");
  },
};

function buildPrompt(request: AgentRelayExecutionRequestMessage): string {
  const messageText =
    typeof request.request?.message?.text === "string"
      ? request.request.message.text
      : "";
  const systemPrompt =
    typeof request.request?.instructions?.systemPrompt === "string"
      ? request.request.instructions.systemPrompt
      : "";
  if (systemPrompt && messageText) {
    return `${systemPrompt}\n\n${messageText}`;
  }
  return messageText || systemPrompt;
}

/**
 * Register the worker on the given relay and start handling execution
 * requests. Caller owns relay lifecycle (start/shutdown); bridge owns
 * subscription lifecycle.
 *
 * Tests can inject a single shared RelayAdapter to sidestep the
 * cross-process broker-discovery pitfall where each Node process's
 * RelayAdapter spawns its own broker subprocess instead of sharing one
 * via {cwd}/.agent-relay/connection.json.
 */
export async function createRelayWorkerBridge(
  config: RelayWorkerBridgeConfig,
): Promise<RelayWorkerBridgeHandle> {
  const logger = config.logger ?? consoleLogger;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const registerWorker = config.registerWorker ?? true;
  const backendId = `byoh-worker:${config.runner.id}`;

  if (registerWorker) {
    const spawnResult = await config.relay.spawn({
      name: config.workerName,
      cli: "bash",
      task: "cat >/dev/null",
      includeWorkflowConventions: false,
    });
    if (!spawnResult.success) {
      throw new Error(
        `Failed to register worker '${config.workerName}' with broker: ${spawnResult.error ?? "unknown error"}`,
      );
    }
  }

  logger.info("registered", {
    workerName: config.workerName,
    channel: config.channelId,
    cli: config.runner.id,
    cwd: config.cwd,
  });

  let disposed = false;

  const handleEvent = async (event: BrokerEvent): Promise<void> => {
    if (disposed) return;
    if (event.kind !== "relay_inbound") return;
    if (event.target !== config.workerName) return;

    let parsed: AgentRelayExecutionRequestMessage;
    try {
      parsed = JSON.parse(event.body) as AgentRelayExecutionRequestMessage;
    } catch {
      return;
    }
    if (parsed.type !== AGENT_RELAY_EXECUTION_REQUEST_TYPE) return;

    const prompt = buildPrompt(parsed);
    logger.info("request", {
      turnId: parsed.turnId,
      threadId: parsed.threadId,
      promptPreview: prompt.slice(0, 80),
    });

    const runnerResult = await config.runner.run({
      prompt,
      timeoutMs,
      cwd: config.cwd,
      env: config.env,
      model: config.model,
    });

    if (runnerResult.status === "completed") {
      logger.info("completed", {
        turnId: parsed.turnId,
        chars: runnerResult.text.length,
      });
    } else {
      logger.error("failed", {
        turnId: parsed.turnId,
        error: runnerResult.error,
      });
    }

    const executionResult = toExecutionResult(runnerResult, backendId);

    try {
      await config.relay.sendMessage({
        to: parsed.replyTo.agentId,
        from: config.workerName,
        threadId: parsed.threadId,
        text: JSON.stringify({
          type: AGENT_RELAY_EXECUTION_RESULT_TYPE,
          turnId: parsed.turnId,
          threadId: parsed.threadId,
          executionResult,
        }),
      });
    } catch (error) {
      logger.error("publish_failed", {
        turnId: parsed.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const unsubscribe = config.relay.onEvent((event) => {
    void handleEvent(event);
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}

function toExecutionResult(
  runnerResult: Awaited<ReturnType<CliRunner["run"]>>,
  backendId: string,
): ExecutionResult {
  if (runnerResult.status === "completed") {
    return {
      backendId,
      status: "completed",
      output: { text: runnerResult.text },
    };
  }
  return {
    backendId,
    status: "failed",
    error: {
      code: "backend_execution_error",
      message: runnerResult.error,
      retryable: false,
      ...(runnerResult.stderr || runnerResult.exitCode !== undefined
        ? {
            metadata: {
              ...(runnerResult.stderr ? { stderr: runnerResult.stderr } : {}),
              ...(runnerResult.exitCode !== undefined
                ? { exitCode: runnerResult.exitCode }
                : {}),
            },
          }
        : {}),
    },
  };
}
