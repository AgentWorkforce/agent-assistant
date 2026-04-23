#!/usr/bin/env node
/**
 * BYOH worker bridge. Long-running process that:
 *
 *   1. Registers with a local agent-relay broker under --worker-name on --channel.
 *   2. Listens for `agent-assistant.execution-request.v1` messages.
 *   3. Invokes the configured CLI (claude / codex / opencode / gemini / bash)
 *      non-interactively with the request text as the prompt.
 *   4. Wraps the CLI's stdout in `agent-assistant.execution-result.v1` and
 *      sends it back to the sender on the same thread.
 *
 * Exists as an example for local experimentation. The `runWorkerBridge`
 * helper is also exported so tests can drive the loop with an injected
 * RelayAdapter — avoiding cross-process broker-sharing pitfalls.
 *
 * Level B will migrate the CliRunner + bridge logic into
 * @agent-assistant/harness/worker-bridge.
 */
import { spawn as spawnChild } from "node:child_process";
import process from "node:process";

import { RelayAdapter, type BrokerEvent } from "@agent-relay/sdk";
import {
  AGENT_RELAY_EXECUTION_REQUEST_TYPE,
  AGENT_RELAY_EXECUTION_RESULT_TYPE,
  type AgentRelayExecutionRequestMessage,
} from "@agent-assistant/harness/agent-relay";
import type { ExecutionResult } from "@agent-assistant/harness";

export type CliName = "claude" | "codex" | "opencode" | "gemini" | "bash";

export type WorkerBridgeOptions = {
  cli: CliName;
  /** Only meaningful with --cli bash; appended to `bash -c`. */
  cliArgs: string[];
  channel: string;
  workerName: string;
  /** Used as subprocess cwd for CLI invocations. RelayAdapter cwd is supplied separately. */
  cwd: string;
  model?: string;
  timeoutMs: number;
};

type CliInvocation = {
  command: string;
  args: string[];
  promptViaStdin: boolean;
};

type CliRunnerResult =
  | { status: "completed"; text: string }
  | { status: "failed"; error: string; stderr?: string };

const HELP = `
Usage: byoh-worker [options]

Options:
  --cli <name>            claude | codex | opencode | gemini | bash (default: claude)
  --cli-args <string>     Extra args appended to the CLI invocation (one shell-like string).
                          Only used with --cli bash; ignored otherwise.
  --channel <id>          Relay channel to listen on (default: $RELAY_CHANNEL or 'specialists')
  --worker-name <name>    Agent name to register (default: $RELAY_WORKER or 'specialist-worker')
  --cwd <path>            Working directory for the RelayAdapter (default: process.cwd())
  --model <id>            Model passed to the CLI (default: unset; CLI's own default)
  --timeout-ms <n>        Per-invocation timeout for the CLI subprocess (default: 120000)
  -h, --help              Show this help

Env var fallbacks: RELAY_CHANNEL, RELAY_WORKER, RELAY_MODEL, BYOH_WORKER_TIMEOUT_MS

Example (claude):
  npm run worker -- --cli claude --model claude-sonnet-4-6

Example (bash stub, useful for smoke testing):
  npm run worker -- --cli bash --cli-args 'echo "stub response"'
`;

function isCliName(value: string): value is CliName {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "gemini" ||
    value === "bash"
  );
}

function splitShellArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function parseArgs(argv: readonly string[]): WorkerBridgeOptions {
  let cli: CliName = "claude";
  let cliArgs: string[] = [];
  let channel = process.env.RELAY_CHANNEL ?? "specialists";
  let workerName = process.env.RELAY_WORKER ?? "specialist-worker";
  let cwd = process.cwd();
  let model = process.env.RELAY_MODEL;
  let timeoutMs = Number(process.env.BYOH_WORKER_TIMEOUT_MS ?? "120000");

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
      case "--cli": {
        const value = next();
        if (!isCliName(value)) {
          throw new Error(
            `--cli must be one of claude|codex|opencode|gemini|bash (got '${value}')`,
          );
        }
        cli = value;
        break;
      }
      case "--cli-args":
        cliArgs = splitShellArgs(next());
        break;
      case "--channel":
        channel = next();
        break;
      case "--worker-name":
        workerName = next();
        break;
      case "--cwd":
        cwd = next();
        break;
      case "--model":
        model = next();
        break;
      case "--timeout-ms":
        timeoutMs = Number(next());
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error(`--timeout-ms must be a positive integer`);
        }
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { cli, cliArgs, channel, workerName, cwd, model, timeoutMs };
}

export function buildInvocation(
  opts: WorkerBridgeOptions,
  prompt: string,
): CliInvocation {
  switch (opts.cli) {
    case "claude": {
      const args = ["-p", "--output-format", "text"];
      if (opts.model) args.push("--model", opts.model);
      args.push(prompt);
      return { command: "claude", args, promptViaStdin: false };
    }
    case "codex": {
      const args = ["exec"];
      if (opts.model) args.push("-m", opts.model);
      args.push(prompt);
      return { command: "codex", args, promptViaStdin: false };
    }
    case "opencode": {
      const args = ["run"];
      if (opts.model) args.push("-m", opts.model);
      args.push(prompt);
      return { command: "opencode", args, promptViaStdin: false };
    }
    case "gemini": {
      const args = ["-p", prompt];
      if (opts.model) args.push("-m", opts.model);
      return { command: "gemini", args, promptViaStdin: false };
    }
    case "bash": {
      const scriptBody =
        opts.cliArgs.length > 0 ? opts.cliArgs.join(" ") : "cat";
      return {
        command: "bash",
        args: ["-c", scriptBody],
        promptViaStdin: true,
      };
    }
  }
}

export async function runCli(
  opts: WorkerBridgeOptions,
  prompt: string,
): Promise<CliRunnerResult> {
  const invocation = buildInvocation(opts, prompt);
  return new Promise((resolve) => {
    const child = spawnChild(invocation.command, invocation.args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: [invocation.promptViaStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: CliRunnerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({
        status: "failed",
        error: `CLI '${opts.cli}' timed out after ${opts.timeoutMs}ms`,
        stderr: stderr.slice(-2000),
      });
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      settle({
        status: "failed",
        error: `Failed to spawn '${invocation.command}': ${error.message}`,
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        settle({ status: "completed", text: stdout.trimEnd() });
        return;
      }
      settle({
        status: "failed",
        error: `CLI '${opts.cli}' exited with code ${code}`,
        stderr: stderr.slice(-2000),
      });
    });

    if (invocation.promptViaStdin && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

export function toExecutionResult(
  runnerResult: CliRunnerResult,
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
      ...(runnerResult.stderr
        ? { metadata: { stderr: runnerResult.stderr } }
        : {}),
    },
  };
}

export function extractPrompt(
  request: AgentRelayExecutionRequestMessage,
): string {
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

export type WorkerBridgeHandle = {
  /** Unsubscribe from the relay and stop handling new requests. */
  dispose(): void;
};

/**
 * Register the worker on the given relay and start handling execution
 * requests. Caller is responsible for relay lifecycle (start/shutdown).
 * Intended for both the CLI entrypoint and tests — tests can inject a
 * single RelayAdapter shared with the orchestrator, avoiding the
 * cross-process broker-discovery issue where each Node process spawns
 * its own broker subprocess.
 */
export async function runWorkerBridge(
  relay: RelayAdapter,
  opts: WorkerBridgeOptions,
): Promise<WorkerBridgeHandle> {
  const backendId = `byoh-worker:${opts.cli}`;

  const spawnResult = await relay.spawn({
    name: opts.workerName,
    cli: "bash",
    task: "cat >/dev/null",
    includeWorkflowConventions: false,
  });
  if (!spawnResult.success) {
    throw new Error(
      `Failed to register worker '${opts.workerName}' with broker: ${spawnResult.error ?? "unknown error"}`,
    );
  }

  console.log(
    `[byoh-worker] registered as '${opts.workerName}' on channel '${opts.channel}' (cli=${opts.cli}, cwd=${opts.cwd})`,
  );
  if (opts.cli !== "bash") {
    console.log(
      `[byoh-worker] invoking '${opts.cli}' per request; timeout=${opts.timeoutMs}ms`,
    );
  }

  let disposed = false;

  const handleEvent = async (event: BrokerEvent): Promise<void> => {
    if (disposed) return;
    if (event.kind !== "relay_inbound") return;
    if (event.target !== opts.workerName) return;

    let parsed: AgentRelayExecutionRequestMessage;
    try {
      parsed = JSON.parse(event.body) as AgentRelayExecutionRequestMessage;
    } catch {
      return;
    }
    if (parsed.type !== AGENT_RELAY_EXECUTION_REQUEST_TYPE) return;

    const prompt = extractPrompt(parsed);
    console.log(
      `[byoh-worker] turn=${parsed.turnId} thread=${parsed.threadId} prompt=${JSON.stringify(prompt.slice(0, 80))}...`,
    );

    const runnerResult = await runCli(opts, prompt);
    if (runnerResult.status === "completed") {
      console.log(
        `[byoh-worker] turn=${parsed.turnId} completed (${runnerResult.text.length} chars)`,
      );
    } else {
      console.error(
        `[byoh-worker] turn=${parsed.turnId} failed: ${runnerResult.error}`,
      );
    }

    const executionResult = toExecutionResult(runnerResult, backendId);

    try {
      await relay.sendMessage({
        to: parsed.replyTo.agentId,
        from: opts.workerName,
        threadId: parsed.threadId,
        text: JSON.stringify({
          type: AGENT_RELAY_EXECUTION_RESULT_TYPE,
          turnId: parsed.turnId,
          threadId: parsed.threadId,
          executionResult,
        }),
      });
    } catch (error) {
      console.error(
        `[byoh-worker] failed to publish result for turn=${parsed.turnId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  const unsubscribe = relay.onEvent((event) => {
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

async function runCliEntrypoint(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const relay = new RelayAdapter({
    cwd: opts.cwd,
    channels: [opts.channel],
  });
  await relay.start();

  const handle = await runWorkerBridge(relay, opts);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[byoh-worker] shutting down (${signal})...`);
    handle.dispose();
    await relay.release(opts.workerName).catch(() => {});
    await relay.shutdown().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Only auto-run when invoked directly. Importing this file (from tests or
// Level B's harness migration) should not spin up a broker.
const invokedAsScript = process.argv[1]?.endsWith("byoh-worker.ts");
if (invokedAsScript) {
  runCliEntrypoint().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
