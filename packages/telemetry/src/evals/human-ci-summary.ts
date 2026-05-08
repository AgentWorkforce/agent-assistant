import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HumanEvalRunSummary, HumanEvalTrial } from './human-suite.js';

export interface HumanEvalCiSummaryOptions {
  rootDir: string;
  runsDir?: string;
  githubStepSummaryPath?: string;
  title?: string;
}

export interface HumanEvalCiSummaryResult {
  runDir: string;
  result: HumanEvalRunSummary;
  markdown: string;
  failed: HumanEvalTrial[];
  skipped: HumanEvalTrial[];
  needsHuman: HumanEvalTrial[];
}

export function summarizeLatestHumanEvalRunForCi(
  options: HumanEvalCiSummaryOptions,
): HumanEvalCiSummaryResult {
  const runsDir = options.runsDir ?? path.join(options.rootDir, '.evals', 'runs');
  const runDir = findLatestHumanEvalRunDir(runsDir);
  const result = JSON.parse(readFileSync(path.join(runDir, 'result.json'), 'utf8')) as HumanEvalRunSummary;
  const markdown = renderHumanEvalCiSummary({
    title: options.title,
    rootDir: options.rootDir,
    runDir,
    result,
  });

  if (options.githubStepSummaryPath) {
    writeFileSync(options.githubStepSummaryPath, markdown, { flag: 'a' });
  }

  return {
    runDir,
    result,
    markdown,
    failed: result.tests.filter((test) => test.status === 'failed'),
    skipped: result.tests.filter((test) => test.status === 'skipped'),
    needsHuman: result.tests.filter((test) => test.status === 'needs-human'),
  };
}

export function renderHumanEvalCiSummary(input: {
  title?: string;
  rootDir: string;
  runDir: string;
  result: HumanEvalRunSummary;
}): string {
  const failed = input.result.tests.filter((test) => test.status === 'failed');
  const skipped = input.result.tests.filter((test) => test.status === 'skipped');
  const needsHuman = input.result.tests.filter((test) => test.status === 'needs-human');
  const reviewPath = path.join(input.runDir, 'human-review.md');
  const lines = [
    `# ${input.title ?? 'Human Eval CI Summary'}`,
    '',
    `- Run directory: \`${path.relative(input.rootDir, input.runDir)}\``,
    `- Mode: \`${input.result.mode}\``,
    `- Git SHA: \`${input.result.git_sha}\``,
    `- Passed: ${input.result.passed}`,
    `- Needs human review: ${input.result.needs_human}`,
    `- Failed: ${input.result.failed}`,
    `- Skipped: ${input.result.skipped}`,
    '',
  ];

  appendStatusSection(lines, 'Failed', failed);
  appendStatusSection(lines, 'Skipped', skipped);
  appendHumanReviewSection(lines, input.rootDir, reviewPath, needsHuman);
  return `${lines.join('\n')}\n`;
}

function appendStatusSection(lines: string[], title: string, tests: HumanEvalTrial[]): void {
  if (tests.length === 0) return;
  lines.push(`## ${title}`, '');
  for (const test of tests) {
    lines.push(`- \`${test.id}\` (${test.suite}/${test.executor})`);
    if (test.error) lines.push(`  - ${test.error}`);
    for (const check of test.checks ?? []) {
      if (check.passed) continue;
      lines.push(`  - FAIL ${check.name}: ${check.message}`);
    }
  }
  lines.push('');
}

function appendHumanReviewSection(
  lines: string[],
  rootDir: string,
  reviewPath: string,
  tests: HumanEvalTrial[],
): void {
  if (tests.length === 0) {
    lines.push('## Human Review', '', 'No cases require human review.', '');
    return;
  }

  lines.push(
    '## Human Review',
    '',
    `These ${tests.length} cases passed deterministic checks but still need a human verdict against their Must / Must Not rubric.`,
    '',
    `Review worksheet: \`${path.relative(rootDir, reviewPath)}\``,
    '',
  );

  const bySuite = new Map<string, HumanEvalTrial[]>();
  for (const test of tests) {
    const suite = test.suite ?? 'unknown';
    if (!bySuite.has(suite)) bySuite.set(suite, []);
    bySuite.get(suite)?.push(test);
  }

  for (const [suite, suiteTests] of [...bySuite.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${suite}`, '');
    for (const test of suiteTests) {
      lines.push(`- \`${test.id}\``);
    }
    lines.push('');
  }
}

function findLatestHumanEvalRunDir(runsDir: string): string {
  if (!existsSync(runsDir)) {
    throw new Error(`No human eval runs found at ${runsDir}`);
  }
  const runs = readdirSync(runsDir)
    .map((dir) => path.join(runsDir, dir))
    .filter((dir) => existsSync(path.join(dir, 'result.json')))
    .map((dir) => ({
      dir,
      result: JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8')) as HumanEvalRunSummary,
    }))
    .sort((a, b) => String(b.result.timestamp).localeCompare(String(a.result.timestamp)));

  if (runs.length === 0) {
    throw new Error(`No human eval result.json files found at ${runsDir}`);
  }

  return runs[0]?.dir ?? runsDir;
}
