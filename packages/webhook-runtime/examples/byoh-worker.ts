#!/usr/bin/env node
/**
 * BYOH worker CLI entrypoint. Thin wrapper around
 * `@agent-assistant/harness/worker-bridge`:
 *
 *   1. Parses argv + env into a WorkerBridgeOptions-like config.
 *   2. Instantiates the chosen CliRunner (claude / codex / opencode /
 *      gemini / bash).
 *   3. Starts a RelayAdapter, calls createRelayWorkerBridge, and keeps
 *      the process alive until SIGINT/SIGTERM.
 *
 * All bridge behavior — request parsing, CLI invocation, response
 * shaping, broker protocol — lives in
 * packages/harness/src/worker-bridge/ where it is unit-tested and
 * covered by an integration test.
 */
import process from "node:process";

import { RelayAdapter } from "@agent-relay/sdk";
import {
  createBashCliRunner,
  createClaudeCliRunner,
  createCodexCliRunner,
  createGeminiCliRunner,
  createOpenCodeCliRunner,
  createRelayWorkerBridge,
  type CliRunner,
} from "@agent-assistant/harness/worker-bridge";

type CliName = "claude" | "codex" | "opencode" | "gemini" | "bash";

type CliOptions = {
  cli: CliName;
  cliArgs: string[];
  channel: string;
  workerName: string;
  cwd: string;
  model?: string;
  timeoutMs: number;
};

const HELP = `
Usage: byoh-worker [options]

Options:
  --cli <name>            claude | codex | opencode | gemini | bash (default: claude)
  --cli-args <string>     Shell-split extra args; only meaningful for --cli bash
                          (becomes the script body passed to bash -c).
  --channel <id>          Relay channel to listen on (default: $RELAY_CHANNEL or 'specialists')
  --worker-name <name>    Agent name to register (default: $RELAY_WORKER or 'specialist-worker')
  --cwd <path>            Working directory for the RelayAdapter (default: process.cwd())
  --model <id>            Model passed to the CLI (default: unset; CLI's own default)
  --timeout-ms <n>        Per-invocation timeout for the CLI subprocess (default: 120000)
  -h, --help              Show this help

Env var fallbacks: RELAY_CHANNEL, RELAY_WORKER, RELAY_MODEL, BYOH_WORKER_TIMEOUT_MS
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

function parseArgs(argv: readonly string[]): CliOptions {
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
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
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

function selectRunner(opts: CliOptions): CliRunner {
  switch (opts.cli) {
    case "claude":
      return createClaudeCliRunner();
    case "codex":
      return createCodexCliRunner();
    case "opencode":
      return createOpenCodeCliRunner();
    case "gemini":
      return createGeminiCliRunner();
    case "bash":
      return createBashCliRunner({
        script: opts.cliArgs.length > 0 ? opts.cliArgs.join(" ") : "cat",
      });
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const runner = selectRunner(opts);

  const relay = new RelayAdapter({
    cwd: opts.cwd,
    channels: [opts.channel],
  });
  await relay.start();

  const bridge = await createRelayWorkerBridge({
    relay,
    channelId: opts.channel,
    workerName: opts.workerName,
    runner,
    cwd: opts.cwd,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[byoh-worker] shutting down (${signal})...`);
    bridge.dispose();
    await relay.release(opts.workerName).catch(() => {});
    await relay.shutdown().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
