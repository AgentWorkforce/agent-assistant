import {
  invokeCli,
  type CliRunner,
  type CliRunnerInput,
  type CliRunnerResult,
  type SpawnFn,
} from "./cli-runner.js";

export interface OpenCodeCliRunnerConfig {
  command?: string;
  spawnFn?: SpawnFn;
}

export function createOpenCodeCliRunner(
  config: OpenCodeCliRunnerConfig = {},
): CliRunner {
  const command = config.command ?? "opencode";
  return {
    id: "opencode",
    async run(input: CliRunnerInput): Promise<CliRunnerResult> {
      const args: string[] = ["run"];
      if (input.model) args.push("-m", input.model);
      args.push(input.prompt);
      return invokeCli(
        "opencode",
        { command, args, promptViaStdin: false },
        input,
        config.spawnFn,
      );
    },
  };
}
