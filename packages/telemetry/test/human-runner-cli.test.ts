import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultHumanEvalExecutors, runHumanEvalCli } from '../src/evals/human-runner-cli.js';

describe('runHumanEvalCli', () => {
  it('runs custom product executors and writes artifacts', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-'));
    const suiteDir = path.join(rootDir, 'evals', 'suites', 'smoke');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(path.join(suiteDir, 'cases.jsonl'), `${JSON.stringify({
      id: 'smoke.hello',
      suite: 'smoke',
      executor: 'product',
      input: { message: 'hello' },
      expected: {
        contentIncludes: ['hello'],
        must: ['Answer the user.'],
        humanReviewRequired: true,
      },
      tags: ['smoke'],
    })}\n`);

    const exitCode = await runHumanEvalCli({
      argv: [],
      rootDir,
      runsDir: path.join(rootDir, '.evals', 'runs'),
      productName: 'NightCTO Evals',
      executors: {
        product() {
          return { content: 'hello there', toolCalls: [] };
        },
      },
    });

    expect(exitCode).toBe(0);
    const runsDir = path.join(rootDir, '.evals', 'runs');
    const runName = readFileSync(path.join(runsDir, readdirSingle(runsDir), 'result.json'), 'utf8');
    expect(runName).toContain('"needs_human": 1');
    expect(runName).toContain('"status": "needs-human"');
  });

  it('creates review worksheets without running deterministic checks in review-only mode', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-review-only-'));
    const suiteDir = path.join(rootDir, 'evals', 'suites', 'smoke');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(path.join(suiteDir, 'cases.jsonl'), `${JSON.stringify({
      id: 'smoke.review-only',
      suite: 'smoke',
      executor: 'manual',
      input: { message: 'hello' },
      expected: {
        contentIncludes: ['this output is not available yet'],
        must: ['Review the eventual output.'],
        humanReviewRequired: true,
      },
    })}\n`);

    const exitCode = await runHumanEvalCli({
      argv: ['--review-only'],
      rootDir,
      runsDir: path.join(rootDir, '.evals', 'runs'),
      productName: 'NightCTO Evals',
    });

    expect(exitCode).toBe(0);
    const runsDir = path.join(rootDir, '.evals', 'runs');
    const result = readFileSync(path.join(runsDir, readdirSingle(runsDir), 'result.json'), 'utf8');
    expect(result).toContain('"needs_human": 1');
    expect(result).toContain('"status": "needs-human"');
    expect(result).toContain('"checks": []');
  });

  it('can override selected cases to a provider executor', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-executor-'));
    const suiteDir = path.join(rootDir, 'evals', 'suites', 'smoke');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(path.join(suiteDir, 'cases.jsonl'), `${JSON.stringify({
      id: 'smoke.manual-provider',
      suite: 'smoke',
      executor: 'manual',
      input: { message: 'hello' },
      expected: {
        contentIncludes: ['provider answer'],
        humanReviewRequired: true,
      },
    })}\n`);

    const exitCode = await runHumanEvalCli({
      argv: ['--provider', '--executor', 'provider'],
      rootDir,
      runsDir: path.join(rootDir, '.evals', 'runs'),
      executors: {
        provider() {
          return { content: 'provider answer', toolCalls: [] };
        },
      },
    });

    expect(exitCode).toBe(0);
    const runsDir = path.join(rootDir, '.evals', 'runs');
    const result = readFileSync(path.join(runsDir, readdirSingle(runsDir), 'result.json'), 'utf8');
    expect(result).toContain('"executor": "provider"');
    expect(result).toContain('provider answer');
  });

  it('rejects manual candidate output paths outside the eval root', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-path-'));
    const executors = createDefaultHumanEvalExecutors(rootDir);

    expect(() => executors.manual?.({
      id: 'smoke.escape',
      suite: 'smoke',
      executor: 'manual',
      input: { message: 'hello', candidateOutputPath: '../escape.txt' },
      expected: {},
    })).toThrow('Eval path must stay within rootDir');
  });

  it('rejects transcript paths outside the eval root', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-transcript-path-'));
    const executors = createDefaultHumanEvalExecutors(rootDir);

    expect(() => executors.transcript?.({
      id: 'smoke.escape-transcript',
      suite: 'smoke',
      executor: 'transcript',
      input: { actualPath: '../escape.json' },
      expected: {},
    })).toThrow('Eval path must stay within rootDir');
  });

  it('prints help without loading eval cases or exiting the process', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'aa-human-evals-help-'));

    const exitCode = await runHumanEvalCli({
      argv: ['--help'],
      rootDir,
      productName: 'NightCTO Evals',
    });

    expect(exitCode).toBe(0);
  });
});

function readdirSingle(dir: string): string {
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  return entries[0] ?? '';
}
