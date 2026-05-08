import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertHumanEvalExpected,
  createHumanEvalRunRecord,
  humanEvalNeedsReview,
  loadHumanEvalCasesFromSuitesDir,
  matchesHumanEvalFilters,
  renderHumanEvalReview,
  renderHumanEvalSummary,
  type HumanEvalTrial,
  validateHumanEvalCase,
  writeHumanEvalRunArtifacts,
} from '../src/evals/index.js';

function makeTempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'aa-human-evals-'));
}

describe('human eval suite helpers', () => {
  it('loads JSONL cases from suite directories while ignoring comments and blanks', () => {
    const root = makeTempRoot();
    const suiteDir = path.join(root, 'planning');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(
      path.join(suiteDir, 'cases.jsonl'),
      [
        '# comment',
        '',
        JSON.stringify({
          id: 'planning.case',
          executor: 'manual',
          input: { message: 'Plan the work' },
          expected: { must: ['has validation gates'] },
          tags: ['planning'],
        }),
      ].join('\n'),
    );

    const cases = loadHumanEvalCasesFromSuitesDir(root, { rootDir: root });

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: 'planning.case',
      suite: 'planning',
      source: path.join('planning', 'cases.jsonl'),
      sourceLine: 3,
    });
  });

  it('filters by suite, case id, and tags', () => {
    const evalCase = {
      id: 'routing.github',
      suite: 'routing',
      input: { message: 'list PRs' },
      tags: ['github', 'routing'],
    };

    expect(matchesHumanEvalFilters(evalCase, { suite: 'routing' })).toBe(true);
    expect(matchesHumanEvalFilters(evalCase, { caseId: 'routing.github' })).toBe(true);
    expect(matchesHumanEvalFilters(evalCase, { tags: new Set(['github']) })).toBe(true);
    expect(matchesHumanEvalFilters(evalCase, { tags: new Set(['linear']) })).toBe(false);
  });

  it('validates required case fields', () => {
    expect(() => validateHumanEvalCase({ id: '', suite: 'x', input: {} })).toThrow(/case.id/);
    expect(() => validateHumanEvalCase({ id: 'x', suite: '', input: {} })).toThrow(/case.suite/);
    expect(() => validateHumanEvalCase({ id: 'x', suite: 'y', input: null as never })).toThrow(/case.input/);
  });

  it('applies deterministic expected checks to normalized output', () => {
    const checks = assertHumanEvalExpected(
      {
        id: 'routing.github',
        suite: 'routing',
        input: { message: 'list PRs' },
        expected: {
          tier: 'harness',
          reasonIncludes: 'workspace-data',
          contentIncludes: ['plan'],
          forbidPhrases: ['implemented'],
          toolCallsInclude: ['workspace_list'],
          toolCallsExclude: ['github_create_issue'],
          maxToolCalls: 2,
          maxQuestionMarks: 0,
          must: ['human criterion'],
        },
      },
      {
        tier: 'harness',
        reason: 'heuristic:workspace-data',
        content: 'Here is the plan.',
        toolCalls: [{ name: 'workspace_list' }],
      },
    );

    expect(checks.every((check) => check.passed)).toBe(true);
    expect(checks.map((check) => check.name)).toContain('human:must');
  });

  it('flags outputs that ask too many questions', () => {
    const checks = assertHumanEvalExpected(
      {
        id: 'planning.question-count',
        suite: 'planning',
        input: { message: 'Plan a feature' },
        expected: {
          maxQuestionMarks: 1,
        },
      },
      {
        content: 'What app is this? What user problem matters most?',
        toolCalls: [],
      },
    );

    expect(checks).toContainEqual({
      name: 'maxQuestionMarks',
      passed: false,
      message: 'expected <= 1 question marks, got 2',
    });
  });

  it('ignores malformed maxQuestionMarks values', () => {
    const checks = assertHumanEvalExpected(
      {
        id: 'planning.invalid-question-count',
        suite: 'planning',
        input: { message: 'Plan a feature' },
        expected: {
          maxQuestionMarks: '1' as unknown as number,
        },
      },
      {
        content: 'What app is this? What user problem matters most?',
        toolCalls: [],
      },
    );

    expect(checks.map((check) => check.name)).not.toContain('maxQuestionMarks');
  });

  it('flags human review when requested by expected or grading metadata', () => {
    expect(humanEvalNeedsReview({
      id: 'x',
      suite: 'planning',
      input: {},
      expected: { humanReviewRequired: true },
    })).toBe(true);
    expect(humanEvalNeedsReview({
      id: 'y',
      suite: 'planning',
      input: {},
      grading: { humanReview: true },
    })).toBe(true);
  });

  it('renders and writes run artifacts', () => {
    const root = makeTempRoot();
    const run = createHumanEvalRunRecord({
      branch: 'main',
      gitSha: 'abc123',
      mode: 'offline',
      runDir: path.join(root, 'run-1'),
      selectedCaseCount: 1,
      timestamp: '2026-05-08T00:00:00.000Z',
    });
    const trial: HumanEvalTrial = {
      id: 'planning.case',
      suite: 'planning',
      kind: 'capability',
      executor: 'manual',
      trial: 1,
      tags: [],
      status: 'needs-human',
      duration_ms: 12,
      checks: [{ name: 'status', passed: true, message: 'case executed' }],
      input: { message: 'Plan the feature' },
      expected: {
        must: ['Ask one useful question'],
        mustNot: ['Pretend work is complete'],
      },
      actual: { content: 'A plan requiring review.' },
    };
    run.tests.push(trial);

    const summary = writeHumanEvalRunArtifacts(run, { final: true });

    expect(summary.needs_human).toBe(1);
    expect(renderHumanEvalSummary(summary)).toContain('NEEDS-HUMAN planning.case');
    const review = renderHumanEvalReview(summary);
    expect(review).toContain('Human verdict: TODO');
    expect(review).toContain('### Must');
    expect(review).toContain('Ask one useful question');
    expect(review).toContain('### Must Not');
    expect(review).toContain('Pretend work is complete');
    expect(readFileSync(path.join(root, 'run-1', 'result.json'), 'utf8')).toContain('"needs_human": 1');
  });

  it('ignores malformed human rubric fields while rendering review artifacts', () => {
    const run = createHumanEvalRunRecord({
      branch: 'main',
      gitSha: 'abc123',
      mode: 'offline',
      runDir: path.join(makeTempRoot(), 'run-1'),
      selectedCaseCount: 1,
      timestamp: '2026-05-08T00:00:00.000Z',
    });
    run.tests.push({
      id: 'planning.malformed-rubric',
      suite: 'planning',
      kind: 'capability',
      executor: 'manual',
      trial: 1,
      tags: [],
      status: 'needs-human',
      duration_ms: 12,
      checks: [],
      expected: {
        must: { length: 1 } as unknown as string[],
        mustNot: { length: 1 } as unknown as string[],
      },
      actual: { content: 'Candidate output.' },
    });

    const review = renderHumanEvalReview(summarizeForTest(run));

    expect(review).toContain('## planning.malformed-rubric');
    expect(review).not.toContain('### Must');
    expect(review).not.toContain('### Must Not');
  });
});

function summarizeForTest(run: ReturnType<typeof createHumanEvalRunRecord>) {
  return {
    ...run,
    total_trials: run.tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    needs_human: run.tests.length,
    total_duration_ms: run.tests.reduce((sum, test) => sum + test.duration_ms, 0),
    final: true,
  };
}
