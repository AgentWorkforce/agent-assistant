import { spawn as nodeSpawn } from "node:child_process";

/**
 * CliRunner abstracts "invoke a CLI non-interactively with a prompt, return
 * text output". One implementation per supported CLI (claude / codex /
 * opencode / gemini / bash). Runners do not know about Relay — that's the
 * bridge's job.
 */
export interface CliRunner {
  /** Stable identifier for diagnostics. */
  readonly id: string;
  run(input: CliRunnerInput): Promise<CliRunnerResult>;
}

export interface CliRunnerInput {
  /** The full prompt to hand to the CLI. */
  prompt: string;
  /** Per-invocation wall-clock budget. */
  timeoutMs: number;
  /** Working directory for the subprocess. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment for the subprocess. Defaults to inheriting process.env. */
  env?: NodeJS.ProcessEnv;
  /** Model identifier. Runner decides whether and how to forward it. */
  model?: string;
}

export type CliRunnerResult =
  | {
      status: "completed";
      text: string;
      metadata?: Record<string, unknown>;
    }
  | {
      status: "failed";
      error: string;
      stderr?: string;
      exitCode?: number;
    };

/**
 * Shared subprocess-invocation helper used by the stock runners. Captures
 * stdout/stderr, enforces a timeout, and translates exit status into a
 * CliRunnerResult.
 *
 * `promptViaStdin: true` writes the prompt to the child's stdin and closes
 * it. Otherwise the prompt must already be embedded in `args`.
 */
export async function invokeCli(
  cli: string,
  spec: {
    command: string;
    args: readonly string[];
    promptViaStdin: boolean;
  },
  input: CliRunnerInput,
  spawnFn: SpawnFn = defaultSpawn,
): Promise<CliRunnerResult> {
  return new Promise((resolve) => {
    const stdio: ("pipe" | "ignore")[] = [
      spec.promptViaStdin ? "pipe" : "ignore",
      "pipe",
      "pipe",
    ];
    const child = spawnFn(spec.command, [...spec.args], {
      cwd: input.cwd,
      env: input.env ?? process.env,
      stdio,
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
      child.kill?.("SIGKILL");
      settle({
        status: "failed",
        error: `CLI '${cli}' timed out after ${input.timeoutMs}ms`,
        stderr: stderr.slice(-2000),
      });
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      settle({
        status: "failed",
        error: `Failed to spawn '${spec.command}': ${error.message}`,
        stderr: stderr.slice(-2000),
      });
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        settle({ status: "completed", text: stdout.trimEnd() });
        return;
      }
      settle({
        status: "failed",
        error: `CLI '${cli}' exited with code ${code ?? "null"}`,
        stderr: stderr.slice(-2000),
        exitCode: code ?? undefined,
      });
    });

    if (spec.promptViaStdin && child.stdin) {
      child.stdin.write(input.prompt);
      child.stdin.end();
    }
  });
}

/**
 * Minimal structural type mirroring the shape of the real Node.js
 * ChildProcess we need. Exists so tests can pass in a stub without
 * depending on node:child_process internals.
 */
export interface ChildProcessHandle {
  stdin?: {
    write: (data: string) => boolean;
    end: () => void;
  } | null;
  stdout?: {
    on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  } | null;
  stderr?: {
    on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  } | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill?: (signal?: string) => boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: ("pipe" | "ignore")[];
  },
) => ChildProcessHandle;

const defaultSpawn: SpawnFn = (command, args, options) => {
  return nodeSpawn(command, [...args], options) as unknown as ChildProcessHandle;
};
