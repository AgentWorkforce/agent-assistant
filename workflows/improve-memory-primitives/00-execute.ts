import { spawn } from 'node:child_process';
import * as path from 'node:path';

/**
 * Master executor for improve-memory-primitives.
 *
 * Sets up a feature branch on agent-assistant, runs subs sequentially,
 * fails fast. Final sub commits + opens PR. Sage adoption is a separate
 * workflow in the sage repo (improve-sage-memory) that runs AFTER this PR
 * merges and the new package versions publish.
 *
 * Subs:
 *   01 — @agent-assistant/memory primitives (formatRelativeAge,
 *        renderTurnMemoryContext, structured logs, content-hash, query
 *        plumbing, scope load constants)
 *   02 — @agent-assistant/harness memory tool registry
 *        (createMemoryToolRegistry exposing memory_remember/recall/forget)
 *   03 — Final review, commit, push, open PR
 */

// Resolve from the script being executed (process.argv[1]) since the
// agent-assistant repo's tsx runtime transpiles to CJS where import.meta
// is unavailable. The master is always invoked as
//   npx tsx workflows/improve-memory-primitives/00-execute.ts
// from the agent-assistant repo root.
const __dirname = path.dirname(path.resolve(process.argv[1] ?? __filename));

const SUBS = [
  '01-memory-package.ts',
  '02-harness-memory-tools.ts',
  '03-publish-pr.ts',
] as const;

const FEATURE_BRANCH = 'feat/memory-primitives-and-harness-tools';

function exec(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      const t = c.toString();
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on('data', (c) => {
      const t = c.toString();
      stderr += t;
      process.stderr.write(t);
    });
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function runSub(file: string): Promise<{ code: number; failedMarker: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      'agent-relay',
      ['run', path.join(__dirname, file)],
      { stdio: ['inherit', 'pipe', 'pipe'], cwd: process.cwd() },
    );
    let failedMarker = false;
    const onChunk = (chunk: Buffer, sink: NodeJS.WriteStream) => {
      const text = chunk.toString();
      if (/Workflow status:\s*failed/i.test(text)) failedMarker = true;
      sink.write(text);
    };
    child.stdout.on('data', (c) => onChunk(c, process.stdout));
    child.stderr.on('data', (c) => onChunk(c, process.stderr));
    child.on('exit', (code) => resolve({ code: code ?? 1, failedMarker }));
  });
}

async function ensureCleanBranch(): Promise<void> {
  const status = await exec('git status --porcelain');
  if (status.stdout.trim().length > 0) {
    console.error(
      '[master] working tree is dirty. Commit or stash before running this workflow:\n' + status.stdout,
    );
    process.exit(1);
  }

  const head = await exec('git rev-parse --abbrev-ref HEAD');
  const currentBranch = head.stdout.trim();

  if (currentBranch === FEATURE_BRANCH) {
    console.log(`[master] already on ${FEATURE_BRANCH}`);
    return;
  }

  const branchExists = await exec(`git show-ref --verify --quiet refs/heads/${FEATURE_BRANCH}`);
  if (branchExists.code === 0) {
    console.log(`[master] switching to existing ${FEATURE_BRANCH}`);
    const checkout = await exec(`git checkout ${FEATURE_BRANCH}`);
    if (checkout.code !== 0) {
      console.error('[master] checkout failed');
      process.exit(1);
    }
  } else {
    console.log(`[master] creating ${FEATURE_BRANCH} from ${currentBranch}`);
    const create = await exec(`git checkout -b ${FEATURE_BRANCH}`);
    if (create.code !== 0) {
      console.error('[master] branch create failed');
      process.exit(1);
    }
  }
}

async function main() {
  console.log('[master] improve-memory-primitives starting at', new Date().toISOString());
  await ensureCleanBranch();

  for (const sub of SUBS) {
    console.log(`[master] → ${sub}`);
    const { code, failedMarker } = await runSub(sub);
    if (code !== 0 || failedMarker) {
      console.error(
        `[master] ${sub} failed (exit=${code}, failedMarker=${failedMarker}). Stopping. Branch left at ${FEATURE_BRANCH} for inspection.`,
      );
      process.exit(1);
    }
    console.log(`[master] ✓ ${sub} ok`);
  }

  console.log('[master] all sub-workflows passed. PR opened by 03.');
  console.log('[master] After merge, the existing release workflow will publish @agent-assistant/memory + harness new minors. Then run improve-sage-memory in the sage repo.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
