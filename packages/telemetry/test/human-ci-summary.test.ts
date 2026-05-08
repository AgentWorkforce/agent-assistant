import { describe, expect, it } from 'vitest';
import { renderHumanEvalCiSummary } from '../src/evals/human-ci-summary.js';
import type { HumanEvalRunSummary } from '../src/evals/human-suite.js';

describe('renderHumanEvalCiSummary', () => {
  it('groups needs-human cases and includes failed checks', () => {
    const result: HumanEvalRunSummary = {
      schema_version: 1,
      timestamp: '2026-05-08T00:00:00.000Z',
      branch: 'feature/evals',
      git_sha: 'abc123',
      mode: 'provider',
      total_cases: 3,
      total_trials: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      needs_human: 1,
      total_duration_ms: 42,
      final: true,
      tests: [
        {
          id: 'planning.good',
          suite: 'planning',
          kind: 'capability',
          executor: 'manual',
          trial: 1,
          tags: [],
          status: 'needs-human',
          duration_ms: 1,
          checks: [],
        },
        {
          id: 'routing.bad',
          suite: 'routing',
          kind: 'regression',
          executor: 'routing',
          trial: 1,
          tags: [],
          status: 'failed',
          duration_ms: 1,
          checks: [{ name: 'tier', passed: false, message: 'expected harness' }],
        },
      ],
    };

    const markdown = renderHumanEvalCiSummary({
      title: 'NightCTO Eval CI Summary',
      rootDir: '/repo',
      runDir: '/repo/.evals/runs/latest',
      result,
    });

    expect(markdown).toContain('# NightCTO Eval CI Summary');
    expect(markdown).toContain('- Failed: 1');
    expect(markdown).toContain('FAIL tier: expected harness');
    expect(markdown).toContain('### planning');
    expect(markdown).toContain('`planning.good`');
    expect(markdown).toContain('Review worksheet: `.evals/runs/latest/human-review.md`');
  });
});
