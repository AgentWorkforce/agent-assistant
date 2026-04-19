import type {
  Router,
  RouterInput,
  SingleShotAdapter,
  TieredRunner,
  TieredRunnerResult,
} from './types.js';
import type { HarnessRuntime, HarnessTurnInput, HarnessResult } from '../types.js';

export interface TieredRunnerConfig {
  router: Router;
  fast: SingleShotAdapter;
  harness: HarnessRuntime;
  rejectMessage?: string;
}

function extractThreadHistory(
  input: HarnessTurnInput,
): Array<{ role: 'user' | 'assistant'; content: string }> | undefined {
  const blocks = input.context?.blocks;
  if (!blocks) return undefined;
  const history = blocks
    .filter((b) => b.label === 'user' || b.label === 'assistant')
    .map((b) => ({ role: b.label as 'user' | 'assistant', content: b.content }));
  return history.length > 0 ? history : undefined;
}

function extractHarnessText(result: HarnessResult): string | undefined {
  if (result.outcome === 'completed' && result.assistantMessage?.text) {
    return result.assistantMessage.text;
  }
  return undefined;
}

export function createTieredRunner(config: TieredRunnerConfig): TieredRunner {
  return {
    async runTurn(input: HarnessTurnInput): Promise<TieredRunnerResult> {
      const threadHistory = extractThreadHistory(input);

      const routerInput: RouterInput = {
        message: input.message,
        context: input.context,
        threadHistory,
        metadata: input.metadata,
      };

      const decision = await config.router.route(routerInput);

      if (decision.tier === 'fast') {
        const result = await config.fast.generate({
          message: input.message,
          instructions: input.instructions,
          context: input.context,
          threadHistory,
          metadata: input.metadata,
        });
        return {
          tier: 'fast',
          routingDecision: decision,
          text: result.text,
          usage: result.usage,
          singleShot: result,
        };
      }

      if (decision.tier === 'harness') {
        const result = await config.harness.runTurn(input);
        return {
          tier: 'harness',
          routingDecision: decision,
          harnessResult: result,
          text: extractHarnessText(result),
        };
      }

      if (decision.tier !== 'reject') {
        console.warn(`[TieredRunner] Unknown routing tier "${decision.tier}", treating as reject`);
      }

      return {
        tier: 'rejected',
        routingDecision: decision,
        text: config.rejectMessage ?? "I can't help with that request.",
      };
    },
  };
}
