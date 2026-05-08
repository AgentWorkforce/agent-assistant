const REGEX_LITERAL_PATTERN = /^\/(.+)\/([a-z]*)$/u;

export interface EvalEvidenceResult {
  matched: string[];
  missing: string[];
}

export interface EvalForbiddenFanoutLimit {
  toolName: string;
  max: number;
}

export interface EvalBudgetCheck {
  maxToolCalls: number;
  maxLatencyMs: number;
}

export interface EvalBudgetSnapshot {
  toolCalls: number;
  latencyMs: number;
}

export interface EvalFinalOutputCheckResult {
  clean: boolean;
  sanitizedKinds: string[];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function patternToMatcher(pattern: string): (text: string) => boolean {
  const regexMatch = REGEX_LITERAL_PATTERN.exec(pattern);

  if (regexMatch === null) {
    return (text) => text.includes(pattern);
  }

  const source = regexMatch[1] ?? '';
  const flags = regexMatch[2] ?? '';
  const regex = new RegExp(source, flags);
  return (text) => regex.test(text);
}

export function evaluateRequiredEvidence(
  finalOutput: string,
  requiredEvidence: readonly string[] | undefined,
): EvalEvidenceResult {
  if (requiredEvidence === undefined || requiredEvidence.length === 0) {
    return { matched: [], missing: [] };
  }

  const matched: string[] = [];
  const missing: string[] = [];

  for (const pattern of requiredEvidence) {
    const matcher = patternToMatcher(pattern);
    if (matcher(finalOutput)) {
      matched.push(pattern);
    } else {
      missing.push(pattern);
    }
  }

  return {
    matched: [...matched].sort(compareStrings),
    missing: [...missing].sort(compareStrings),
  };
}

export function evaluateForbiddenFanout(
  toolCalls: readonly { toolName: string }[],
  limits: readonly EvalForbiddenFanoutLimit[] | undefined,
): string[] {
  if (limits === undefined || limits.length === 0) {
    return [];
  }

  const callCountByTool = new Map<string, number>();
  for (const toolCall of toolCalls) {
    callCountByTool.set(toolCall.toolName, (callCountByTool.get(toolCall.toolName) ?? 0) + 1);
  }

  const violations: string[] = [];
  for (const limit of limits) {
    const observed = callCountByTool.get(limit.toolName) ?? 0;
    if (observed > limit.max) {
      violations.push(
        `${limit.toolName} called ${observed} times (max ${limit.max})`,
      );
    }
  }

  return violations.sort(compareStrings);
}

export function evaluateBudget(
  budget: EvalBudgetSnapshot,
  limit: EvalBudgetCheck | undefined,
): boolean {
  if (limit === undefined) {
    return true;
  }

  return budget.toolCalls <= limit.maxToolCalls && budget.latencyMs <= limit.maxLatencyMs;
}

export function evaluateFinalOutputClean(
  sanitizedKinds: readonly string[],
): EvalFinalOutputCheckResult {
  return {
    clean: sanitizedKinds.length === 0,
    sanitizedKinds: [...sanitizedKinds].sort(compareStrings),
  };
}
