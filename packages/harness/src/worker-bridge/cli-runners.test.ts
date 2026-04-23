import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  createClaudeCliRunner,
  createCodexCliRunner,
  createOpenCodeCliRunner,
  createGeminiCliRunner,
  createBashCliRunner,
} from "./index.js";
import type {
  ChildProcessHandle,
  CliRunner,
  SpawnFn,
} from "./cli-runner.js";

type SpawnInvocation = {
  command: string;
  args: string[];
  stdio: ("pipe" | "ignore")[];
};

type StubChild = ChildProcessHandle & {
  emitData(stream: "stdout" | "stderr", data: string): void;
  emitClose(code: number | null): void;
  emitError(error: Error): void;
  writtenStdin: string;
  stdinClosed: boolean;
  killedSignal: string | undefined;
};

function createStubChild(): StubChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const closeEmitter = new EventEmitter();
  const errorEmitter = new EventEmitter();
  let writtenStdin = "";
  let stdinClosed = false;
  let killedSignal: string | undefined;

  const child: StubChild = {
    stdin: {
      write: (data: string) => {
        writtenStdin += data;
        return true;
      },
      end: () => {
        stdinClosed = true;
      },
    },
    stdout: {
      on: (event, listener) => {
        stdout.on(event, listener);
        return child;
      },
    },
    stderr: {
      on: (event, listener) => {
        stderr.on(event, listener);
        return child;
      },
    },
    on: ((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "close") closeEmitter.on("close", listener);
      if (event === "error") errorEmitter.on("error", listener);
      return child;
    }) as ChildProcessHandle["on"],
    kill: (signal?: string) => {
      killedSignal = signal;
      return true;
    },
    emitData(stream, data) {
      (stream === "stdout" ? stdout : stderr).emit("data", data);
    },
    emitClose(code) {
      closeEmitter.emit("close", code);
    },
    emitError(error) {
      errorEmitter.emit("error", error);
    },
    get writtenStdin() {
      return writtenStdin;
    },
    get stdinClosed() {
      return stdinClosed;
    },
    get killedSignal() {
      return killedSignal;
    },
  };

  return child;
}

function createCapturingSpawn(): {
  spawnFn: SpawnFn;
  invocations: SpawnInvocation[];
  latestChild(): StubChild;
} {
  const invocations: SpawnInvocation[] = [];
  const children: StubChild[] = [];
  const spawnFn: SpawnFn = (command, args, options) => {
    invocations.push({
      command,
      args: [...args],
      stdio: [...options.stdio],
    });
    const child = createStubChild();
    children.push(child);
    return child;
  };
  return {
    spawnFn,
    invocations,
    latestChild: () => {
      const last = children[children.length - 1];
      if (!last) throw new Error("no child spawned yet");
      return last;
    },
  };
}

async function runAndCaptureClose(
  runner: CliRunner,
  latestChild: () => StubChild,
  options: {
    prompt?: string;
    model?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    timeoutMs?: number;
  },
): Promise<Awaited<ReturnType<CliRunner["run"]>>> {
  const promise = runner.run({
    prompt: options.prompt ?? "hello world",
    timeoutMs: options.timeoutMs ?? 5_000,
    model: options.model,
  });
  // Yield so spawnFn is called and listeners are attached.
  await Promise.resolve();
  const child = latestChild();
  if (options.stdout) child.emitData("stdout", options.stdout);
  if (options.stderr) child.emitData("stderr", options.stderr);
  child.emitClose(options.exitCode ?? 0);
  return promise;
}

describe("CliRunner implementations", () => {
  it("claude runner shapes args correctly and captures stdout", async () => {
    const cap = createCapturingSpawn();
    const runner = createClaudeCliRunner({ spawnFn: cap.spawnFn });
    const result = await runAndCaptureClose(runner, cap.latestChild, {
      prompt: "summarize the open issues",
      model: "claude-sonnet-4-6",
      stdout: "42 open issues, mostly bugs\n",
    });

    expect(cap.invocations).toHaveLength(1);
    expect(cap.invocations[0]).toEqual({
      command: "claude",
      args: [
        "-p",
        "--output-format",
        "text",
        "--model",
        "claude-sonnet-4-6",
        "summarize the open issues",
      ],
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result).toEqual({
      status: "completed",
      text: "42 open issues, mostly bugs",
    });
  });

  it("codex runner uses 'exec' subcommand and -m flag", async () => {
    const cap = createCapturingSpawn();
    const runner = createCodexCliRunner({ spawnFn: cap.spawnFn });
    await runAndCaptureClose(runner, cap.latestChild, {
      prompt: "write a regex",
      model: "gpt-5.4",
      stdout: "^\\d+$",
    });

    expect(cap.invocations[0]).toEqual({
      command: "codex",
      args: ["exec", "-m", "gpt-5.4", "write a regex"],
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("opencode runner uses 'run' subcommand", async () => {
    const cap = createCapturingSpawn();
    const runner = createOpenCodeCliRunner({ spawnFn: cap.spawnFn });
    await runAndCaptureClose(runner, cap.latestChild, {
      prompt: "deploy the app",
      model: "anthropic/claude-sonnet-4-5",
      stdout: "deployed.",
    });

    expect(cap.invocations[0]).toEqual({
      command: "opencode",
      args: ["run", "-m", "anthropic/claude-sonnet-4-5", "deploy the app"],
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("gemini runner uses -p flag with prompt as argument", async () => {
    const cap = createCapturingSpawn();
    const runner = createGeminiCliRunner({ spawnFn: cap.spawnFn });
    await runAndCaptureClose(runner, cap.latestChild, {
      prompt: "what's the weather",
      stdout: "sunny",
    });

    expect(cap.invocations[0]).toEqual({
      command: "gemini",
      args: ["-p", "what's the weather"],
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("bash runner passes script via -c and pipes prompt on stdin", async () => {
    const cap = createCapturingSpawn();
    const runner = createBashCliRunner({
      script: 'cat; echo "-- done"',
      spawnFn: cap.spawnFn,
    });
    await runAndCaptureClose(runner, cap.latestChild, {
      prompt: "prompt text",
      stdout: "prompt text\n-- done",
    });

    expect(cap.invocations[0]).toEqual({
      command: "bash",
      args: ["-c", 'cat; echo "-- done"'],
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(cap.latestChild().writtenStdin).toBe("prompt text");
    expect(cap.latestChild().stdinClosed).toBe(true);
  });

  it("reports exit code and tail of stderr on non-zero exit", async () => {
    const cap = createCapturingSpawn();
    const runner = createClaudeCliRunner({ spawnFn: cap.spawnFn });
    const result = await runAndCaptureClose(runner, cap.latestChild, {
      stderr: "api error: rate limited",
      exitCode: 2,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("exited with code 2"),
      exitCode: 2,
    });
    if (result.status === "failed") {
      expect(result.stderr).toContain("api error: rate limited");
    }
  });

  it("times out when subprocess never closes", async () => {
    const cap = createCapturingSpawn();
    const runner = createClaudeCliRunner({ spawnFn: cap.spawnFn });
    const promise = runner.run({
      prompt: "hang forever",
      timeoutMs: 50,
    });

    // Yield so the timer + listeners are attached.
    await Promise.resolve();

    const result = await promise;
    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("timed out after 50ms"),
    });
    // Runner should have sent SIGKILL to the stub child.
    expect(cap.latestChild().killedSignal).toBe("SIGKILL");
  });

  it("reports spawn failure via error event", async () => {
    const cap = createCapturingSpawn();
    const runner = createClaudeCliRunner({ spawnFn: cap.spawnFn });
    const promise = runner.run({ prompt: "p", timeoutMs: 5_000 });
    await Promise.resolve();
    cap.latestChild().emitError(new Error("ENOENT: no such file"));

    const result = await promise;
    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("ENOENT: no such file"),
    });
  });
});
