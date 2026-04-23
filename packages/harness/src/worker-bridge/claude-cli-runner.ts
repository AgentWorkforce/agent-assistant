import {
  invokeCli,
  type CliRunner,
  type CliRunnerInput,
  type CliRunnerResult,
  type SpawnFn,
} from "./cli-runner.js";

export interface ClaudeCliRunnerConfig {
  /** Override the executable resolved from PATH. */
  command?: string;
  /** Injected for tests. */
  spawnFn?: SpawnFn;
}

export function createClaudeCliRunner(
  config: ClaudeCliRunnerConfig = {},
): CliRunner {
  const command = config.command ?? "claude";
  return {
    id: "claude",
    async run(input: CliRunnerInput): Promise<CliRunnerResult> {
      const args: string[] = ["-p", "--output-format", "text"];
      if (input.model) args.push("--model", input.model);
      args.push(input.prompt);
      return invokeCli(
        "claude",
        { command, args, promptViaStdin: false },
        input,
        config.spawnFn,
      );
    },
  };
}
