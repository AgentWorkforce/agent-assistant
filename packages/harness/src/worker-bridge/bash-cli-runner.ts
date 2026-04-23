import {
  invokeCli,
  type CliRunner,
  type CliRunnerInput,
  type CliRunnerResult,
  type SpawnFn,
} from "./cli-runner.js";

export interface BashCliRunnerConfig {
  /**
   * Bash script body passed to `bash -c`. The execution-request prompt is
   * piped on stdin, so scripts can consume it via `cat`, `read`, etc.
   * Default: `cat` (echoes the prompt back verbatim).
   */
  script?: string;
  /** Override the bash executable. */
  command?: string;
  spawnFn?: SpawnFn;
}

/**
 * Bash-script runner intended for testing and smoke checks. Produces a
 * deterministic, token-free response so end-to-end wiring can be
 * validated without an AI CLI.
 */
export function createBashCliRunner(
  config: BashCliRunnerConfig = {},
): CliRunner {
  const command = config.command ?? "bash";
  const script = config.script ?? "cat";
  return {
    id: "bash",
    async run(input: CliRunnerInput): Promise<CliRunnerResult> {
      return invokeCli(
        "bash",
        {
          command,
          args: ["-c", script],
          promptViaStdin: true,
        },
        input,
        config.spawnFn,
      );
    },
  };
}
