import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type HumanEvalStatus = 'passed' | 'failed' | 'skipped' | 'needs-human';

export interface HumanEvalCase {
  id: string;
  suite: string;
  executor?: string;
  kind?: 'capability' | 'regression' | string;
  input: Record<string, unknown>;
  expected?: HumanEvalExpected;
  grading?: { humanReview?: boolean; [key: string]: unknown };
  tags?: string[];
  trials?: number;
  mock?: Record<string, unknown>;
  source?: string;
  sourceLine?: number;
}

export interface HumanEvalExpected {
  ok?: boolean;
  tier?: string;
  reasonIncludes?: string;
  stopReason?: string;
  contentIncludes?: string[];
  contentMatches?: string[];
  forbidPhrases?: string[];
  forbidPatterns?: string[];
  toolCallsInclude?: string[];
  toolCallsExclude?: string[];
  maxToolCalls?: number;
  minToolCalls?: number;
  maxQuestionMarks?: number;
  must?: string[];
  mustNot?: string[];
  humanReviewRequired?: boolean;
  [key: string]: unknown;
}

export interface HumanEvalActual {
  ok?: boolean;
  tier?: string;
  reason?: string;
  stopReason?: string;
  status?: string;
  content: string;
  toolCalls: Array<{ name: string; [key: string]: unknown }>;
  notes?: string;
  [key: string]: unknown;
}

export interface HumanEvalCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface HumanEvalTrial {
  id: string;
  suite: string;
  kind: string;
  executor: string;
  trial: number;
  tags: string[];
  status: HumanEvalStatus;
  duration_ms: number;
  checks: HumanEvalCheck[];
  input?: Record<string, unknown>;
  expected?: HumanEvalExpected;
  actual?: Partial<HumanEvalActual>;
  error?: string;
}

export interface HumanEvalRunRecord {
  schema_version: number;
  timestamp: string;
  branch: string;
  git_sha: string;
  mode: 'offline' | 'provider' | string;
  total_cases: number;
  tests: HumanEvalTrial[];
  runDir: string;
}

export interface HumanEvalRunSummary extends Omit<HumanEvalRunRecord, 'runDir'> {
  total_trials: number;
  passed: number;
  failed: number;
  skipped: number;
  needs_human: number;
  total_duration_ms: number;
  final: boolean;
}

export interface HumanEvalCaseFilter {
  suite?: string;
  caseId?: string;
  tags?: ReadonlySet<string>;
}

export interface HumanEvalRunMetadata {
  branch: string;
  gitSha: string;
  mode: 'offline' | 'provider' | string;
  runDir: string;
  selectedCaseCount: number;
  timestamp?: string;
}

export interface LoadHumanEvalCasesOptions {
  rootDir?: string;
}

const SCHEMA_VERSION = 1;

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function addCheck(checks: HumanEvalCheck[], name: string, passed: boolean, message: string): void {
  checks.push({ name, passed: Boolean(passed), message });
}

export function loadHumanEvalCasesFromSuitesDir(
  suitesDir: string,
  options: LoadHumanEvalCasesOptions = {},
): HumanEvalCase[] {
  if (!existsSync(suitesDir)) return [];

  const cases: HumanEvalCase[] = [];
  for (const suiteName of readdirSync(suitesDir).sort(compareStrings)) {
    const casePath = path.join(suitesDir, suiteName, 'cases.jsonl');
    if (!existsSync(casePath)) continue;

    const lines = readFileSync(casePath, 'utf8').split('\n');
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) return;

      try {
        const parsed = JSON.parse(trimmed) as Partial<HumanEvalCase>;
        const { suite: parsedSuite, ...rest } = parsed;
        cases.push({
          ...rest,
          suite: parsedSuite ?? suiteName,
          source: options.rootDir ? path.relative(options.rootDir, casePath) : casePath,
          sourceLine: lineIndex + 1,
        } as HumanEvalCase);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${casePath}:${lineIndex + 1}: ${reason}`);
      }
    });
  }

  return cases;
}

export function matchesHumanEvalFilters(
  evalCase: HumanEvalCase,
  filter: HumanEvalCaseFilter,
): boolean {
  if (filter.suite !== undefined && evalCase.suite !== filter.suite) return false;
  if (filter.caseId !== undefined && evalCase.id !== filter.caseId) return false;

  for (const tag of filter.tags ?? []) {
    if (!Array.isArray(evalCase.tags) || !evalCase.tags.includes(tag)) return false;
  }

  return true;
}

export function validateHumanEvalCase(evalCase: HumanEvalCase): void {
  if (typeof evalCase.id !== 'string' || evalCase.id.length === 0) {
    throw new Error('case.id must be a non-empty string');
  }
  if (typeof evalCase.suite !== 'string' || evalCase.suite.length === 0) {
    throw new Error('case.suite must be a non-empty string');
  }
  if (evalCase.input === null || typeof evalCase.input !== 'object') {
    throw new Error('case.input must be an object');
  }
}

export function normalizeHumanEvalActual(actual: unknown): HumanEvalActual {
  const record = actual !== null && typeof actual === 'object'
    ? (actual as Record<string, unknown>)
    : {};
  const toolCalls = Array.isArray(record.toolCalls)
    ? record.toolCalls
        .filter((call): call is Record<string, unknown> => call !== null && typeof call === 'object')
        .map((call) => ({
          ...call,
          name: String(call.name ?? ''),
        }))
    : [];

  return {
    ...record,
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    tier: typeof record.tier === 'string' ? record.tier : undefined,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    stopReason: typeof record.stopReason === 'string' ? record.stopReason : undefined,
    status: typeof record.status === 'string' ? record.status : undefined,
    content: String(record.content ?? record.responseText ?? record.text ?? ''),
    toolCalls,
    notes: typeof record.notes === 'string' ? record.notes : undefined,
  };
}

export function assertHumanEvalExpected(
  evalCase: HumanEvalCase,
  actualInput: unknown,
): HumanEvalCheck[] {
  const expected = evalCase.expected ?? {};
  const actual = normalizeHumanEvalActual(actualInput);
  const checks: HumanEvalCheck[] = [];

  addCheck(checks, 'status', true, 'case executed');
  if ('ok' in expected) {
    addCheck(checks, 'ok', actual.ok === expected.ok, `expected ok=${expected.ok}, got ${actual.ok}`);
  }
  if ('tier' in expected) {
    addCheck(checks, 'tier', actual.tier === expected.tier, `expected tier=${expected.tier}, got ${actual.tier}`);
  }
  if (expected.reasonIncludes !== undefined) {
    addCheck(
      checks,
      'reasonIncludes',
      String(actual.reason ?? '').includes(expected.reasonIncludes),
      `expected reason to include "${expected.reasonIncludes}", got "${actual.reason ?? ''}"`,
    );
  }
  if ('stopReason' in expected) {
    addCheck(
      checks,
      'stopReason',
      actual.stopReason === expected.stopReason,
      `expected stopReason=${expected.stopReason}, got ${actual.stopReason}`,
    );
  }

  for (const phrase of expected.contentIncludes ?? []) {
    addCheck(
      checks,
      `contentIncludes:${phrase}`,
      actual.content.toLowerCase().includes(String(phrase).toLowerCase()),
      `expected content to include "${phrase}"`,
    );
  }
  for (const pattern of expected.contentMatches ?? []) {
    const regex = new RegExp(pattern, 'i');
    addCheck(checks, `contentMatches:${pattern}`, regex.test(actual.content), `expected content to match /${pattern}/i`);
  }
  for (const phrase of expected.forbidPhrases ?? []) {
    addCheck(
      checks,
      `forbidPhrase:${phrase}`,
      !actual.content.toLowerCase().includes(String(phrase).toLowerCase()),
      `content must not include "${phrase}"`,
    );
  }
  for (const pattern of expected.forbidPatterns ?? []) {
    const regex = new RegExp(pattern, 'i');
    addCheck(checks, `forbidPattern:${pattern}`, !regex.test(actual.content), `content must not match /${pattern}/i`);
  }

  const toolNames = actual.toolCalls.map((call) => call.name);
  for (const name of expected.toolCallsInclude ?? []) {
    addCheck(checks, `toolCallsInclude:${name}`, toolNames.includes(name), `expected tool call "${name}"`);
  }
  for (const name of expected.toolCallsExclude ?? []) {
    addCheck(checks, `toolCallsExclude:${name}`, !toolNames.includes(name), `did not expect tool call "${name}"`);
  }
  if (expected.maxToolCalls !== undefined) {
    addCheck(
      checks,
      'maxToolCalls',
      toolNames.length <= expected.maxToolCalls,
      `expected <= ${expected.maxToolCalls} tool calls, got ${toolNames.length}`,
    );
  }
  if (expected.minToolCalls !== undefined) {
    addCheck(
      checks,
      'minToolCalls',
      toolNames.length >= expected.minToolCalls,
      `expected >= ${expected.minToolCalls} tool calls, got ${toolNames.length}`,
    );
  }
  if (expected.maxQuestionMarks !== undefined) {
    const questionMarkCount = (actual.content.match(/\?/g) ?? []).length;
    addCheck(
      checks,
      'maxQuestionMarks',
      questionMarkCount <= expected.maxQuestionMarks,
      `expected <= ${expected.maxQuestionMarks} question marks, got ${questionMarkCount}`,
    );
  }

  if (Array.isArray(expected.must) && expected.must.length > 0) {
    addCheck(checks, 'human:must', true, `${expected.must.length} human must criteria recorded`);
  }
  if (Array.isArray(expected.mustNot) && expected.mustNot.length > 0) {
    addCheck(checks, 'human:mustNot', true, `${expected.mustNot.length} human must-not criteria recorded`);
  }

  return checks;
}

export function humanEvalNeedsReview(evalCase: HumanEvalCase): boolean {
  return Boolean(evalCase.expected?.humanReviewRequired || evalCase.grading?.humanReview);
}

export function createHumanEvalRunRecord(metadata: HumanEvalRunMetadata): HumanEvalRunRecord {
  return {
    schema_version: SCHEMA_VERSION,
    timestamp: metadata.timestamp ?? new Date().toISOString(),
    branch: metadata.branch,
    git_sha: metadata.gitSha,
    mode: metadata.mode,
    total_cases: metadata.selectedCaseCount,
    tests: [],
    runDir: metadata.runDir,
  };
}

export function summarizeHumanEvalRun(
  run: HumanEvalRunRecord,
  options: { final?: boolean } = {},
): HumanEvalRunSummary {
  return {
    schema_version: run.schema_version,
    timestamp: run.timestamp,
    branch: run.branch,
    git_sha: run.git_sha,
    mode: run.mode,
    total_cases: run.total_cases,
    total_trials: run.tests.length,
    passed: run.tests.filter((test) => test.status === 'passed').length,
    failed: run.tests.filter((test) => test.status === 'failed').length,
    skipped: run.tests.filter((test) => test.status === 'skipped').length,
    needs_human: run.tests.filter((test) => test.status === 'needs-human').length,
    total_duration_ms: run.tests.reduce((sum, test) => sum + test.duration_ms, 0),
    final: Boolean(options.final),
    tests: run.tests,
  };
}

export function renderHumanEvalSummary(result: HumanEvalRunSummary): string {
  const lines = [
    '# Agent Assistant Eval Run',
    '',
    `- Timestamp: ${result.timestamp}`,
    `- Branch: ${result.branch}`,
    `- Git SHA: ${result.git_sha}`,
    `- Mode: ${result.mode}`,
    `- Trials: ${result.total_trials}`,
    `- Passed: ${result.passed}`,
    `- Needs human: ${result.needs_human}`,
    `- Failed: ${result.failed}`,
    `- Skipped: ${result.skipped}`,
    '',
    '## Results',
    '',
  ];

  for (const test of result.tests) {
    lines.push(`- ${test.status.toUpperCase()} ${test.id} (${test.suite}/${test.executor}, trial ${test.trial}, ${test.duration_ms}ms)`);
    for (const check of test.checks) {
      lines.push(`  - ${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}`);
    }
    if (test.error !== undefined) lines.push(`  - Error: ${test.error}`);
  }

  return `${lines.join('\n')}\n`;
}

export function renderHumanEvalReview(result: HumanEvalRunSummary): string {
  const reviewTests = result.tests.filter((test) => test.status === 'needs-human' || test.status === 'failed');
  const lines = [
    '# Agent Assistant Eval Human Review',
    '',
    'Use this worksheet to decide whether the deterministic result was fair and whether the case/rubric needs adjustment.',
    '',
  ];

  if (reviewTests.length === 0) {
    lines.push('No cases currently require human review.');
    return `${lines.join('\n')}\n`;
  }

  for (const test of reviewTests) {
    lines.push(`## ${test.id}`);
    lines.push('');
    lines.push(`- Status: ${test.status}`);
    lines.push(`- Suite: ${test.suite}`);
    lines.push(`- Executor: ${test.executor}`);
    if (test.input?.message !== undefined) {
      lines.push(`- Message: ${String(test.input.message)}`);
    }
    if (test.input?.actualPath !== undefined) {
      lines.push(`- Actual path: ${String(test.input.actualPath)}`);
    }
    lines.push('');
    if ((test.expected?.must?.length ?? 0) > 0) {
      lines.push('### Must');
      lines.push('');
      for (const item of test.expected?.must ?? []) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
    if ((test.expected?.mustNot?.length ?? 0) > 0) {
      lines.push('### Must Not');
      lines.push('');
      for (const item of test.expected?.mustNot ?? []) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
    const deterministicChecks = test.checks.filter((check) => !check.name.startsWith('human:'));
    if (deterministicChecks.length > 0) {
      lines.push('### Deterministic Checks');
      lines.push('');
      for (const check of deterministicChecks) {
        lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}`);
      }
      lines.push('');
    }
    lines.push('Human verdict: TODO pass / fail / case-bug / grader-bug');
    lines.push('');
    lines.push('Notes:');
    lines.push('');
    if ((test.actual?.content ?? '').length > 0) {
      lines.push('### Output');
      lines.push('');
    }
    lines.push('```');
    lines.push(((test.actual?.content ?? '') || 'No assistant output captured for this executor.').slice(0, 4000));
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function writeHumanEvalRunArtifacts(
  run: HumanEvalRunRecord,
  options: { final?: boolean } = {},
): HumanEvalRunSummary {
  mkdirSync(run.runDir, { recursive: true });
  const summary = summarizeHumanEvalRun(run, options);
  writeFileSync(path.join(run.runDir, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(run.runDir, 'summary.md'), renderHumanEvalSummary(summary));
  writeFileSync(path.join(run.runDir, 'human-review.md'), renderHumanEvalReview(summary));
  return summary;
}
