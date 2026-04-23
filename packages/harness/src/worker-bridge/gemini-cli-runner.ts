import {
  invokeCli,
  type CliRunner,
  type CliRunnerInput,
  type CliRunnerResult,
  type SpawnFn,
} from "./cli-runner.js";

export interface GeminiCliRunnerConfig {
  command?: string;
  spawnFn?: SpawnFn;
}

export function createGeminiCliRunner(
  config: GeminiCliRunnerConfig = {},
): CliRunner {
  const command = config.command ?? "gemini";
  return {
    id: "gemini",
    async run(input: CliRunnerInput): Promise<CliRunnerResult> {
      const args: string[] = ["-p", input.prompt];
      if (input.model) args.push("-m", input.model);
      return invokeCli(
        "gemini",
        { command, args, promptViaStdin: false },
        input,
        config.spawnFn,
      );
    },
  };
}
