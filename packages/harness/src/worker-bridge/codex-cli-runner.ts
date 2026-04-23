import {
  invokeCli,
  type CliRunner,
  type CliRunnerInput,
  type CliRunnerResult,
  type SpawnFn,
} from "./cli-runner.js";

export interface CodexCliRunnerConfig {
  command?: string;
  spawnFn?: SpawnFn;
}

export function createCodexCliRunner(
  config: CodexCliRunnerConfig = {},
): CliRunner {
  const command = config.command ?? "codex";
  return {
    id: "codex",
    async run(input: CliRunnerInput): Promise<CliRunnerResult> {
      const args: string[] = ["exec"];
      if (input.model) args.push("-m", input.model);
      args.push(input.prompt);
      return invokeCli(
        "codex",
        { command, args, promptViaStdin: false },
        input,
        config.spawnFn,
      );
    },
  };
}
