import {
  evaluateBudget,
  evaluateFinalOutputClean,
  evaluateForbiddenFanout,
  evaluateRequiredEvidence,
  type EvalBudgetCheck,
  type EvalForbiddenFanoutLimit,
} from './eval-checks.js';

export interface ProviderFixture {
  outputText: string;
  modelId?: string;
  latencyMs?: number;
  cost?: number;
}

export interface ToolFixture {
  name: string;
  input?: unknown;
  outputText: string;
  latencyMs?: number;
  cost?: number;
}

export interface EvalCase {
  name: string;
  fixture: { providerResponses: ProviderFixture[]; tools: ToolFixture[] };
  checks: {
    requiredEvidence?: string[];
    forbiddenFanout?: EvalForbiddenFanoutLimit[];
    budget?: EvalBudgetCheck;
    finalOutputClean?: boolean;
  };
}

export interface EvalToolCallRecord {
  toolName: string;
  latencyMs?: number;
  cost?: number;
}

export interface EvalTurnRunnerInput {
  caseName: string;
  fixture: EvalCase['fixture'];
}

export interface EvalTurnRunResult {
  finalOutput: string;
  toolCalls?: EvalToolCallRecord[];
  latencyMs?: number;
  cost?: number;
  sanitizedKinds?: string[];
}

export type EvalTurnRunner = (input: EvalTurnRunnerInput) => Promise<EvalTurnRunResult>;

export interface EvalResult {
  name: string;
  passed: boolean;
  score: { components: Record<string, number>; total: number };
  evidence: { matched: string[]; missing: string[] };
  forbiddenFanoutViolations: string[];
  budget: { toolCalls: number; latencyMs: number; cost?: number };
  finalOutputCleanResult: { clean: boolean; sanitizedKinds: string[] };
}

const SCORE_COMPONENT_KEYS = [
  'requiredEvidence',
  'forbiddenFanout',
  'budget',
  'finalOutputClean',
] as const;

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function sumDefinedNumbers(values: readonly (number | undefined)[]): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function deriveToolCalls(fixture: EvalCase['fixture'], run: EvalTurnRunResult): EvalToolCallRecord[] {
  if (run.toolCalls !== undefined) {
    return run.toolCalls.map((toolCall) => ({
      toolName: toolCall.toolName,
      latencyMs: toolCall.latencyMs,
      cost: toolCall.cost,
    }));
  }

  return fixture.tools.map((tool) => ({
    toolName: tool.name,
    latencyMs: tool.latencyMs,
    cost: tool.cost,
  }));
}

function deriveLatencyMs(fixture: EvalCase['fixture'], run: EvalTurnRunResult): number {
  if (run.latencyMs !== undefined) {
    return run.latencyMs;
  }

  return (
    sumDefinedNumbers(fixture.providerResponses.map((response) => response.latencyMs)) +
    sumDefinedNumbers(fixture.tools.map((tool) => tool.latencyMs))
  );
}

function deriveCost(fixture: EvalCase['fixture'], run: EvalTurnRunResult, toolCalls: readonly EvalToolCallRecord[]): number {
  if (run.cost !== undefined) {
    return run.cost;
  }

  return (
    sumDefinedNumbers(fixture.providerResponses.map((response) => response.cost)) +
    sumDefinedNumbers(toolCalls.map((toolCall) => toolCall.cost))
  );
}

function buildScoreComponents(input: {
  evidenceMissingCount: number;
  forbiddenFanoutViolationCount: number;
  budgetPassed: boolean;
  finalOutputCleanPassed: boolean;
}): Record<string, number> {
  return {
    requiredEvidence: input.evidenceMissingCount === 0 ? 1 : 0,
    forbiddenFanout: input.forbiddenFanoutViolationCount === 0 ? 1 : 0,
    budget: input.budgetPassed ? 1 : 0,
    finalOutputClean: input.finalOutputCleanPassed ? 1 : 0,
  };
}

function computeScoreTotal(components: Record<string, number>): number {
  const total =
    SCORE_COMPONENT_KEYS.reduce((sum, key) => sum + (components[key] ?? 0), 0) /
    SCORE_COMPONENT_KEYS.length;

  return Math.round(total * 1000) / 1000;
}

function canonicalizeScore(components: Record<string, number>): EvalResult['score'] {
  const orderedComponents: Record<string, number> = {};
  for (const key of SCORE_COMPONENT_KEYS) {
    orderedComponents[key] = components[key] ?? 0;
  }

  return {
    components: orderedComponents,
    total: computeScoreTotal(orderedComponents),
  };
}

function canonicalizeResult(input: {
  name: string;
  passed: boolean;
  score: Record<string, number>;
  evidenceMatched: string[];
  evidenceMissing: string[];
  forbiddenFanoutViolations: string[];
  toolCalls: number;
  latencyMs: number;
  cost: number;
  finalOutputCleanResult: { clean: boolean; sanitizedKinds: string[] };
}): EvalResult {
  return {
    name: input.name,
    passed: input.passed,
    score: canonicalizeScore(input.score),
    evidence: {
      matched: [...input.evidenceMatched].sort(compareStrings),
      missing: [...input.evidenceMissing].sort(compareStrings),
    },
    forbiddenFanoutViolations: [...input.forbiddenFanoutViolations].sort(compareStrings),
    budget: {
      toolCalls: input.toolCalls,
      latencyMs: input.latencyMs,
      cost: input.cost,
    },
    finalOutputCleanResult: {
      clean: input.finalOutputCleanResult.clean,
      sanitizedKinds: [...input.finalOutputCleanResult.sanitizedKinds].sort(compareStrings),
    },
  };
}

async function runEvalCase(
  evalCase: EvalCase,
  runner: EvalTurnRunner,
): Promise<EvalResult> {
  const run = await runner({
    caseName: evalCase.name,
    fixture: evalCase.fixture,
  });
  const toolCalls = deriveToolCalls(evalCase.fixture, run);
  const latencyMs = deriveLatencyMs(evalCase.fixture, run);
  const cost = deriveCost(evalCase.fixture, run, toolCalls);
  const evidence = evaluateRequiredEvidence(run.finalOutput, evalCase.checks.requiredEvidence);
  const forbiddenFanoutViolations = evaluateForbiddenFanout(
    toolCalls,
    evalCase.checks.forbiddenFanout,
  );
  const budgetPassed = evaluateBudget(
    {
      toolCalls: toolCalls.length,
      latencyMs,
    },
    evalCase.checks.budget,
  );
  const finalOutputCleanResult = evaluateFinalOutputClean(run.sanitizedKinds ?? []);
  const finalOutputCleanPassed =
    evalCase.checks.finalOutputClean === true ? finalOutputCleanResult.clean : true;
  const score = buildScoreComponents({
    evidenceMissingCount: evidence.missing.length,
    forbiddenFanoutViolationCount: forbiddenFanoutViolations.length,
    budgetPassed,
    finalOutputCleanPassed,
  });
  const passed =
    evidence.missing.length === 0 &&
    forbiddenFanoutViolations.length === 0 &&
    budgetPassed &&
    finalOutputCleanPassed;

  return canonicalizeResult({
    name: evalCase.name,
    passed,
    score,
    evidenceMatched: evidence.matched,
    evidenceMissing: evidence.missing,
    forbiddenFanoutViolations,
    toolCalls: toolCalls.length,
    latencyMs,
    cost,
    finalOutputCleanResult,
  });
}

export async function runEvalSuite(
  cases: EvalCase[],
  runner: EvalTurnRunner,
): Promise<EvalResult[]> {
  const results = await Promise.all(cases.map((evalCase) => runEvalCase(evalCase, runner)));
  return [...results].sort((left, right) => compareStrings(left.name, right.name));
}
