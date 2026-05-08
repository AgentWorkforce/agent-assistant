import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertHumanEvalExpected,
  createHumanEvalRunRecord,
  humanEvalNeedsReview,
  loadHumanEvalCasesFromSuitesDir,
  matchesHumanEvalFilters,
  normalizeHumanEvalActual,
  summarizeHumanEvalRun,
  writeHumanEvalRunArtifacts,
  type HumanEvalActual,
  type HumanEvalCase,
  type HumanEvalRunRecord,
} from './human-suite.js';

export interface HumanEvalExecutorContext {
  providerMode: boolean;
  rootDir: string;
}

export type HumanEvalExecutor = (
  testCase: HumanEvalCase,
  context: HumanEvalExecutorContext,
) => Promise<unknown> | unknown;

export interface RunHumanEvalCliOptions {
  argv: string[];
  rootDir: string;
  suitesDir?: string;
  runsDir?: string;
  productName?: string;
  envFile?: string;
  executors?: Record<string, HumanEvalExecutor>;
  defaultExecutor?: string;
  redactActual?: (actual: unknown) => Partial<HumanEvalActual>;
}

interface ParsedArgs {
  provider?: boolean;
  reviewOnly?: boolean;
  help?: boolean;
  list?: boolean;
  suite?: string;
  caseId?: string;
  executor?: string;
  tags: Set<string>;
  trials?: number;
}

const DEFAULT_PRODUCT_NAME = 'Human Eval';

export async function runHumanEvalCli(options: RunHumanEvalCliOptions): Promise<number> {
  loadDotenv(options.envFile ?? path.join(options.rootDir, '.env'));
  const args = parseArgs(options.argv);
  if (args.help) {
    printHelp(options.productName ?? DEFAULT_PRODUCT_NAME);
    return 0;
  }

  const providerMode = args.provider || process.env.SAGE_EVAL_PROVIDER === '1' || process.env.HUMAN_EVAL_PROVIDER === '1';
  const suitesDir = options.suitesDir ?? path.join(options.rootDir, 'evals', 'suites');
  const runsDir = options.runsDir ?? path.join(options.rootDir, '.evals', 'runs');
  const allCases = loadHumanEvalCasesFromSuitesDir(suitesDir, { rootDir: options.rootDir });
  const selectedCases = allCases.filter((testCase) => matchesHumanEvalFilters(testCase, {
    suite: args.suite,
    caseId: args.caseId,
    tags: args.tags,
  }));

  if (args.list) {
    listCases(selectedCases);
    return 0;
  }

  if (selectedCases.length === 0) {
    console.log('No eval cases selected.');
    console.log('Add human-authored JSONL cases under evals/suites/*/cases.jsonl.');
    console.log('Try: --list');
    return 0;
  }

  const run = createRunRecord({
    rootDir: options.rootDir,
    runsDir,
    selectedCases,
    providerMode,
  });
  mkdirSync(run.runDir, { recursive: true });

  const executors = {
    ...createDefaultHumanEvalExecutors(options.rootDir),
    ...(options.executors ?? {}),
  };
  const defaultExecutor = options.defaultExecutor ?? 'manual';
  const redactActual = options.redactActual ?? defaultRedactActual;

  for (const testCase of selectedCases) {
    const trials = readPositiveInt(args.trials ?? testCase.trials, 1);
    for (let trialIndex = 0; trialIndex < trials; trialIndex += 1) {
      const startedAt = Date.now();
      const executorName = args.executor ?? testCase.executor ?? defaultExecutor;
      const trial = {
        id: testCase.id,
        suite: testCase.suite,
        kind: testCase.kind ?? 'capability',
        executor: executorName,
        trial: trialIndex + 1,
        tags: testCase.tags ?? [],
        status: 'failed' as const,
        duration_ms: 0,
        checks: [],
        input: testCase.input,
        expected: testCase.expected,
      };

      try {
        const executor = args.reviewOnly
          ? undefined
          : executors[executorName];
        if (!args.reviewOnly && executor === undefined) {
          throw new Error(`Unknown executor "${executorName}" for ${testCase.id}`);
        }

        const actual = args.reviewOnly
          ? { status: 'manual_review_required', content: '', toolCalls: [] }
          : await executor?.(testCase, { providerMode, rootDir: options.rootDir });
        const checks = args.reviewOnly ? [] : assertHumanEvalExpected(testCase, actual);
        const deterministicPassed = args.reviewOnly || checks.every((check) => check.passed);
        const needsHuman = humanEvalNeedsReview(testCase);

        run.tests.push({
          ...trial,
          status: deterministicPassed ? (needsHuman ? 'needs-human' : 'passed') : 'failed',
          actual: redactActual(actual),
          checks,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        run.tests.push({
          ...trial,
          status: isSkippedError(error) ? 'skipped' : 'failed',
          error: error instanceof Error ? error.message : String(error),
          duration_ms: Date.now() - startedAt,
        });
      } finally {
        writeHumanEvalRunArtifacts(run);
      }
    }
  }

  writeHumanEvalRunArtifacts(run, { final: true });
  printHumanEvalRunSummary(run, { productName: options.productName ?? DEFAULT_PRODUCT_NAME, rootDir: options.rootDir });
  return run.tests.some((test) => test.status === 'failed') ? 1 : 0;
}

export function createDefaultHumanEvalExecutors(rootDir: string): Record<string, HumanEvalExecutor> {
  return {
    manual(testCase) {
      if (typeof testCase.input.candidateOutput === 'string') {
        return {
          status: 'manual_review_required',
          content: testCase.input.candidateOutput,
          toolCalls: [],
          notes: 'Manual executor used input.candidateOutput.',
        };
      }
      if (typeof testCase.input.candidateOutputPath === 'string') {
        const fullPath = resolvePathWithinRoot(rootDir, testCase.input.candidateOutputPath);
        return {
          status: 'manual_review_required',
          content: readFileSync(fullPath, 'utf8'),
          toolCalls: [],
          notes: `Manual executor read ${testCase.input.candidateOutputPath}.`,
        };
      }
      return {
        status: 'manual_review_required',
        content: '',
        toolCalls: [],
        notes: 'Manual executor does not run the product. Add Candidate Output or Candidate Output Path to review an answer.',
      };
    },
    transcript(testCase) {
      const actualPath = testCase.input.actualPath ?? testCase.input.transcriptPath;
      if (typeof actualPath !== 'string') {
        throw new Error('transcript executor requires input.actualPath');
      }
      const fullPath = resolvePathWithinRoot(rootDir, actualPath);
      return normalizeHumanEvalActual(JSON.parse(readFileSync(fullPath, 'utf8')));
    },
  };
}

export function resolvePathWithinRoot(rootDir: string, filePath: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Eval path must stay within rootDir: ${filePath}`);
  }
  return resolved;
}

export function createSkippedEvalError(message: string): Error {
  const error = new Error(message);
  Object.assign(error, { code: 'HUMAN_EVAL_SKIPPED' });
  return error;
}

export function loadDotenv(filePath: string): void {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1] ?? '';
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseDotenvValue(match[2] ?? '');
  }
}

export function defaultRedactActual(actualInput: unknown): Partial<HumanEvalActual> {
  const actual = normalizeHumanEvalActual(actualInput);
  return {
    ok: actual.ok,
    tier: actual.tier,
    reason: actual.reason,
    stopReason: actual.stopReason,
    status: actual.status,
    content: actual.content,
    toolCalls: actual.toolCalls,
    notes: actual.notes,
  };
}

export function printHumanEvalRunSummary(
  run: HumanEvalRunRecord,
  options: { productName?: string; rootDir?: string } = {},
): void {
  const result = summarizeHumanEvalRun(run, { final: true });
  const rootDir = options.rootDir ?? process.cwd();
  const reviewPath = path.relative(rootDir, path.join(run.runDir, 'human-review.md'));
  console.log('');
  console.log(`${options.productName ?? DEFAULT_PRODUCT_NAME} Run`);
  console.log('='.repeat(64));
  console.log(`passed=${result.passed} needs-human=${result.needs_human} failed=${result.failed} skipped=${result.skipped}`);
  console.log(`dir=${path.relative(rootDir, run.runDir)}`);
  if (result.needs_human > 0 || result.failed > 0) {
    console.log(`review=${reviewPath}`);
  }
  for (const test of result.tests) {
    console.log(`${test.status.padEnd(11)} ${test.id}`);
    if (test.error) console.log(`  ${test.error}`);
    if (test.status === 'needs-human' || test.status === 'failed') {
      printHumanReviewPrompt(test);
    }
    if ((test.status === 'needs-human' || test.status === 'failed') && test.actual?.content) {
      printCapturedOutput(test.actual.content);
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { tags: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--provider') parsed.provider = true;
    else if (arg === '--review-only') parsed.reviewOnly = true;
    else if (arg === '--list') parsed.list = true;
    else if (arg === '--suite') parsed.suite = argv[++index];
    else if (arg === '--case') parsed.caseId = argv[++index];
    else if (arg === '--executor') parsed.executor = argv[++index];
    else if (arg === '--tag') parsed.tags.add(argv[++index] ?? '');
    else if (arg === '--trials') parsed.trials = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp(productName: string): void {
  console.log(`Usage: ${productName} [options]

Options:
  --list             List selected cases without running them.
  --suite NAME       Run one suite.
  --case ID          Run one case id.
  --executor NAME    Override selected cases to run with this executor.
  --tag TAG          Require a tag. Can be repeated.
  --trials N         Override trial count for every case.
  --provider         Allow provider-backed product cases.
  --review-only      Do not execute cases; create human review worksheets.
`);
}

function listCases(cases: HumanEvalCase[]): void {
  if (cases.length === 0) {
    console.log('No eval cases found.');
    return;
  }
  for (const testCase of cases) {
    const tags = Array.isArray(testCase.tags) && testCase.tags.length > 0
      ? ` [${testCase.tags.join(',')}]`
      : '';
    console.log(`${testCase.id} (${testCase.suite}/${testCase.executor ?? 'manual'})${tags}`);
  }
}

function createRunRecord(input: {
  rootDir: string;
  runsDir: string;
  selectedCases: HumanEvalCase[];
  providerMode: boolean;
}): HumanEvalRunRecord {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const git = getGitInfo(input.rootDir);
  const runName = `${timestamp}-${sanitize(git.branch)}-${input.providerMode ? 'provider' : 'offline'}`;
  return createHumanEvalRunRecord({
    timestamp: new Date().toISOString(),
    branch: git.branch,
    gitSha: git.sha,
    mode: input.providerMode ? 'provider' : 'offline',
    selectedCaseCount: input.selectedCases.length,
    runDir: path.join(input.runsDir, runName),
  });
}

function getGitInfo(rootDir: string): { branch: string; sha: string } {
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).stdout.trim() || 'unknown';
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).stdout.trim() || 'unknown';
  return { branch, sha };
}

function readPositiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80);
}

function parseDotenvValue(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, '\n');
}

function isSkippedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (
    (error as { code?: unknown }).code === 'HUMAN_EVAL_SKIPPED' ||
    (error as { code?: unknown }).code === 'SAGE_EVAL_SKIPPED'
  ));
}

function printHumanReviewPrompt(test: { input?: Record<string, unknown>; expected?: Record<string, unknown>; checks: Array<{ name: string; passed: boolean }> }): void {
  if (test.input?.message) {
    console.log(`  Message: ${String(test.input.message).replace(/\s+/g, ' ').trim()}`);
  }
  if (Array.isArray(test.expected?.must) && test.expected.must.length > 0) {
    console.log('  Must:');
    for (const item of test.expected.must) {
      console.log(`    - ${String(item)}`);
    }
  }
  if (Array.isArray(test.expected?.mustNot) && test.expected.mustNot.length > 0) {
    console.log('  Must Not:');
    for (const item of test.expected.mustNot) {
      console.log(`    - ${String(item)}`);
    }
  }
  const deterministicChecks = test.checks.filter((check) => !check.name.startsWith('human:'));
  if (deterministicChecks.length > 0) {
    console.log('  Checks:');
    for (const check of deterministicChecks) {
      console.log(`    - ${check.passed ? 'PASS' : 'FAIL'} ${check.name}`);
    }
  }
}

function printCapturedOutput(content: unknown): void {
  const text = String(content).trim();
  if (text.length === 0) return;
  const maxChars = 1600;
  const preview = text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
  console.log('  Output:');
  for (const line of preview.split('\n')) {
    console.log(`    ${line}`);
  }
}
