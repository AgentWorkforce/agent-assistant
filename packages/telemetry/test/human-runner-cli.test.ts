import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHumanEvalCli } from '../src/evals/human-runner-cli.js';

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
});

function readdirSingle(dir: string): string {
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  return entries[0] ?? '';
}
