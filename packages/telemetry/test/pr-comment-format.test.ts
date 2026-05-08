import { describe, expect, it } from 'vitest';

import { formatPrCommentSummary, type EvalResult } from '../src/evals/index.js';

function createResult(overrides: Partial<EvalResult> & Pick<EvalResult, 'name' | 'passed'>): EvalResult {
  return {
    name: overrides.name,
    passed: overrides.passed,
    score: overrides.score ?? {
      components: {
        requiredEvidence: overrides.passed ? 1 : 0,
        forbiddenFanout: overrides.passed ? 1 : 0,
        budget: overrides.passed ? 1 : 0,
        finalOutputClean: overrides.passed ? 1 : 0,
      },
      total: overrides.passed ? 1 : 0.25,
    },
    evidence: overrides.evidence ?? {
      matched: overrides.passed ? ['package.json'] : [],
      missing: overrides.passed ? [] : ['docs/spec.md'],
    },
    forbiddenFanoutViolations: overrides.forbiddenFanoutViolations ?? (
      overrides.passed ? [] : ['workspace_list called 4 times (max 2)']
    ),
    budget: overrides.budget ?? {
      toolCalls: overrides.passed ? 2 : 6,
      latencyMs: overrides.passed ? 24 : 145,
      cost: overrides.passed ? 0.2 : 1.7,
    },
    finalOutputCleanResult: overrides.finalOutputCleanResult ?? {
      clean: overrides.passed,
      sanitizedKinds: overrides.passed ? [] : ['pseudo_tool_fence'],
    },
  };
}

describe('formatPrCommentSummary', () => {
  it('keeps the markdown under the size cap and uses compact failure details', () => {
    const results: EvalResult[] = Array.from({ length: 40 }, (_, index) =>
      createResult({
        name: `case-${String(index).padStart(2, '0')}`,
        passed: index % 3 !== 0,
      }),
    );

    const summary = formatPrCommentSummary(results);

    expect(Buffer.byteLength(summary, 'utf8')).toBeLessThanOrEqual(4 * 1024);
    expect(summary).toContain('## Eval Summary');
    expect(summary).toContain('<details>');
    expect(summary).toContain('Additional eval detail omitted');
  });

  it('orders failures before passes and sorts names deterministically', () => {
    const summary = formatPrCommentSummary([
      createResult({ name: 'bravo', passed: true }),
      createResult({ name: 'alpha', passed: false }),
      createResult({ name: 'charlie', passed: false }),
    ]);

    const alphaIndex = summary.indexOf('FAIL `alpha`');
    const charlieIndex = summary.indexOf('FAIL `charlie`');
    const bravoIndex = summary.indexOf('PASS `bravo`');

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(charlieIndex).toBeGreaterThan(alphaIndex);
    expect(bravoIndex).toBeGreaterThan(charlieIndex);
    expect(summary).toContain('missing evidence: docs/spec.md');
  });
});
