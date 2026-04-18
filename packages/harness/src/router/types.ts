import type {
  HarnessUserMessage,
  HarnessPreparedContext,
  HarnessUsage,
  HarnessTurnInput,
  HarnessResult,
} from '../types.js';

export type RoutingTier = 'fast' | 'harness' | 'reject';

export interface RoutingDecision {
  tier: RoutingTier;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RouterInput {
  message: HarnessUserMessage;
  context?: HarnessPreparedContext;
  threadHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface Router {
  route(input: RouterInput): Promise<RoutingDecision>;
}

export interface SingleShotInput {
  message: HarnessUserMessage;
  instructions: { systemPrompt: string; developerPrompt?: string };
  context?: HarnessPreparedContext;
  threadHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface SingleShotResult {
  text: string;
  usage?: HarnessUsage;
  metadata?: Record<string, unknown>;
}

export interface SingleShotAdapter {
  generate(input: SingleShotInput): Promise<SingleShotResult>;
}

export interface TieredRunner {
  runTurn(input: HarnessTurnInput): Promise<TieredRunnerResult>;
}

export type TieredRunnerResult =
  | TieredRunnerFastResult
  | TieredRunnerHarnessResult
  | TieredRunnerRejectedResult;

export interface TieredRunnerFastResult {
  tier: 'fast';
  routingDecision: RoutingDecision;
  text: string;
  usage?: HarnessUsage;
  singleShot: SingleShotResult;
}

export interface TieredRunnerHarnessResult {
  tier: 'harness';
  routingDecision: RoutingDecision;
  harnessResult: HarnessResult;
  text?: string;
}

export interface TieredRunnerRejectedResult {
  tier: 'rejected';
  routingDecision: RoutingDecision;
  text: string;
}
