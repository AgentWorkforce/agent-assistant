import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

/**
 * Sub 3 — `GitHubPublicFetcher` + `createGitHubPublicReviewToolRegistry`.
 *
 * Why this lifts upstream:
 *   The prime sage use case (cross-org review of an external public repo
 *   like "review montanaflynn/headless-terminal vs relay") fails today
 *   because github_specialist requires authenticated access to the user's
 *   own org. Sage's workaround is a sage-side fetcher hitting
 *   unauthenticated api.github.com. This is exactly the kind of primitive
 *   that belongs upstream — any harness consumer that talks to a model
 *   about external open-source code wants this tool.
 *
 * Contract:
 *
 * - NEW file packages/harness/src/tools/github-public-fetcher.ts:
 *
 *   export interface GitHubPublicReview {
 *     owner: string;
 *     repo: string;
 *     description?: string;
 *     license?: string;
 *     stargazersCount?: number;
 *     openIssuesCount?: number;
 *     defaultBranch?: string;
 *     htmlUrl?: string;
 *     readme?: string; // raw README text, truncated to ~16k chars
 *     packageJson?: unknown; // parsed package.json, if present at repo root
 *     topLevel?: Array<{ path: string; type: 'file' | 'dir' }>;
 *     recentCommits?: Array<{ sha: string; message: string; authorDate: string }>;
 *   }
 *
 *   export class GitHubPublicFetchError extends Error {
 *     readonly status?: number;
 *     readonly code: 'not_found' | 'rate_limited' | 'invalid_request' | 'transport' | 'unknown';
 *     readonly bodyExcerpt?: string;
 *   }
 *
 *   export interface GitHubPublicFetcherOptions {
 *     fetchImpl?: typeof globalThis.fetch; // override for tests; defaults to globalThis.fetch
 *     userAgent?: string; // default 'agent-assistant-harness'
 *     readmeMaxChars?: number; // default 16384
 *     commitsCount?: number; // default 5; capped at 20
 *   }
 *
 *   export class GitHubPublicFetcher {
 *     constructor(options?: GitHubPublicFetcherOptions);
 *     fetchReview(owner: string, repo: string): Promise<GitHubPublicReview>;
 *   }
 *
 *   Implementation rules:
 *   - Use globalThis.fetch (Cloudflare Workers safe per workers-fetch rule).
 *   - Every Response body is consumed (.text() / .json()) or .body.cancel()'d.
 *     Never leak a Response.
 *   - Endpoints (sequential, fail-soft for optional pieces — readme/pkg-json
 *     missing is normal; only the /repos/{owner}/{repo} call is required):
 *       GET https://api.github.com/repos/{owner}/{repo}
 *       GET https://api.github.com/repos/{owner}/{repo}/readme  (Accept: application/vnd.github.raw)
 *       GET https://api.github.com/repos/{owner}/{repo}/contents/package.json (base64-decoded)
 *       GET https://api.github.com/repos/{owner}/{repo}/contents/  (top level)
 *       GET https://api.github.com/repos/{owner}/{repo}/commits?per_page={commitsCount}
 *   - 404 on /repos → throws GitHubPublicFetchError with code='not_found'.
 *   - 403 with X-RateLimit-Remaining: 0 → code='rate_limited'.
 *   - Owner / repo must match /^[A-Za-z0-9_.-]+$/ — invalid input throws
 *     code='invalid_request' before any network call.
 *   - Truncate readme to readmeMaxChars; append "\n[truncated]" marker if cut.
 *
 * - NEW file packages/harness/src/tools/github-public-review-tool-registry.ts:
 *
 *   export const GITHUB_PUBLIC_REVIEW_TOOL_NAME = 'github_public_review';
 *
 *   export interface GitHubPublicReviewToolRegistryOptions {
 *     fetcher?: GitHubPublicFetcher; // optional; default = new GitHubPublicFetcher()
 *   }
 *
 *   export function createGitHubPublicReviewToolRegistry(
 *     options?: GitHubPublicReviewToolRegistryOptions,
 *   ): HarnessToolRegistry;
 *
 *   The registry exposes a single tool:
 *     github_public_review({ owner: string, repo: string })
 *   Schema enforces both fields, both strings, regex-validated client-side.
 *   Returns the GitHubPublicReview as structuredOutput, with a
 *   human-readable summary in result.output.
 *
 * - Re-export from packages/harness/src/index.ts:
 *     GitHubPublicFetcher, GitHubPublicFetchError, GitHubPublicReview,
 *     GitHubPublicFetcherOptions, createGitHubPublicReviewToolRegistry,
 *     GITHUB_PUBLIC_REVIEW_TOOL_NAME, GitHubPublicReviewToolRegistryOptions.
 *
 * Minor bump on @agent-assistant/harness.
 */

async function runWorkflow() {
  const result = await workflow('improve-harness-primitives-03-github-public')
    .description(
      'Add GitHubPublicFetcher + createGitHubPublicReviewToolRegistry to @agent-assistant/harness — unauthenticated public-repo readme/package.json/top-level/commits fetcher exposed as a github_public_review tool.',
    )
    .pattern('dag')
    .channel('wf-aa-harness-03')
    .maxConcurrency(2)
    .timeout(3_600_000) // 1h — meatier sub
    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Architect/reviewer for the GitHub public review tool.',
      retries: 1,
    })
    .agent('impl', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Implementer for the fetcher + tool registry + tests.',
      retries: 2,
    })

    .step('read-tools-context', {
      type: 'deterministic',
      command:
        'cat packages/harness/src/tools/workspace-tool-registry.ts | head -120 && echo --- && ' +
        'cat packages/harness/src/types.ts | sed -n "1,260p" && echo --- && ' +
        'cat packages/harness/src/index.ts',
      captureOutput: true,
    })

    .step('implement-fetcher', {
      agent: 'impl',
      dependsOn: ['read-tools-context'],
      task: `Create packages/harness/src/tools/github-public-fetcher.ts.

Reference context (workspace-tool-registry pattern + types):
{{steps.read-tools-context.output}}

Follow the exact contract in the workflow JSDoc — re-read this sub's source if needed: workflows/improve-harness-primitives/03-github-public-review.ts.

Hard rules:
1. Use globalThis.fetch (NOT a top-level imported fetch — that breaks under Cloudflare Workers).
2. Every Response body is either fully consumed (.text() / .json()) or .body?.cancel()'d. No fire-and-forget.
3. The /repos call is the only REQUIRED endpoint — readme / package.json / contents / commits are best-effort. If those error or 404, capture nothing and continue (the GitHubPublicReview field is left undefined).
4. Validate owner / repo regex BEFORE the first network call.
5. License is the SPDX id from repo.license?.spdx_id when available (string, not object).
6. Top-level contents call may return either a single file or an array — only treat it as the directory listing when Array.isArray(json).
7. package.json contents endpoint returns base64-encoded \`content\` — decode via Buffer.from(content, 'base64').toString('utf8') and JSON.parse, swallowing parse errors (returns undefined when malformed).
8. Truncate readme to readmeMaxChars (default 16384). If truncated, append \`\\n[truncated]\`.
9. recent commits map to { sha, message: commit.commit.message, authorDate: commit.commit.author.date }.
10. UA header on every fetch.
11. GitHubPublicFetchError extends Error, has \`status?\`, \`code\`, \`bodyExcerpt?\` — bodyExcerpt is the first 500 chars of the response body for non-OK responses.

Edit ONLY:
- packages/harness/src/tools/github-public-fetcher.ts (new)`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-fetcher', {
      type: 'deterministic',
      dependsOn: ['implement-fetcher'],
      command:
        'test -f packages/harness/src/tools/github-public-fetcher.ts && ' +
        'grep -q "class GitHubPublicFetcher" packages/harness/src/tools/github-public-fetcher.ts && ' +
        'grep -q "globalThis.fetch" packages/harness/src/tools/github-public-fetcher.ts && ' +
        'grep -q "GitHubPublicFetchError" packages/harness/src/tools/github-public-fetcher.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tool-registry', {
      agent: 'impl',
      dependsOn: ['verify-fetcher'],
      task: `Create packages/harness/src/tools/github-public-review-tool-registry.ts.

Imports the fetcher from ./github-public-fetcher.js. Exposes a single tool github_public_review with schema:

{
  type: 'object',
  required: ['owner', 'repo'],
  properties: {
    owner: { type: 'string', minLength: 1 },
    repo:  { type: 'string', minLength: 1 },
  },
}

execute() flow:
- Validate input shape (owner + repo strings present). On bad input return status='error', error.code='invalid_request', retryable=false.
- Call fetcher.fetchReview(owner, repo).
- On GitHubPublicFetchError: map to result with status='error', error.code from the error code, error.message from err.message, retryable: error.code === 'rate_limited'.
- On unknown throw: status='error', error.code='unknown', message: String(err), retryable=false.
- On success: structuredOutput = the GitHubPublicReview object; output = a 8–20 line human-readable summary (\`# {owner}/{repo}\`, description, stars, default branch, license, ## README excerpt (first 800 chars), ## package.json excerpt (name + version + main scripts keys), ## Top-level (paths joined ", "), ## Recent commits (each on one line "sha[0..7]  date  message[0..80]")).

listAvailable: returns [the single tool definition] regardless of input.

Re-export from packages/harness/src/index.ts:
- GitHubPublicFetcher, GitHubPublicFetchError, GitHubPublicReview, GitHubPublicFetcherOptions
- createGitHubPublicReviewToolRegistry, GITHUB_PUBLIC_REVIEW_TOOL_NAME, GitHubPublicReviewToolRegistryOptions

Bump packages/harness/package.json minor version.

Edit ONLY:
- packages/harness/src/tools/github-public-review-tool-registry.ts (new)
- packages/harness/src/index.ts (re-exports)
- packages/harness/package.json (version bump)`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tool-registry', {
      type: 'deterministic',
      dependsOn: ['implement-tool-registry'],
      command:
        'test -f packages/harness/src/tools/github-public-review-tool-registry.ts && ' +
        'grep -q "createGitHubPublicReviewToolRegistry" packages/harness/src/tools/github-public-review-tool-registry.ts && ' +
        'grep -q "github_public_review" packages/harness/src/tools/github-public-review-tool-registry.ts && ' +
        'grep -q "createGitHubPublicReviewToolRegistry" packages/harness/src/index.ts && ' +
        'grep -q "GitHubPublicFetcher" packages/harness/src/index.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests', {
      agent: 'impl',
      dependsOn: ['verify-tool-registry'],
      task: `Add two test files (vitest):

A. packages/harness/src/tools/github-public-fetcher.test.ts

Test cases (use a fetchImpl mock — vi.fn() that returns Response-like objects):

1. Happy path: /repos returns 200 with full body, /readme returns raw README, /contents/package.json returns base64 content, /contents/ returns array, /commits returns array. Resulting GitHubPublicReview has all fields populated correctly.
2. /repos 404 → throws GitHubPublicFetchError with code='not_found', status=404.
3. /repos 403 + X-RateLimit-Remaining: 0 → throws code='rate_limited'.
4. Invalid owner regex (e.g. 'foo/bar') → throws code='invalid_request' with NO fetch calls.
5. /readme 404 → readme stays undefined; review still returns successfully.
6. /contents/package.json malformed (invalid JSON after base64 decode) → packageJson stays undefined; review still returns.
7. /contents/ returns a single file (not array) → topLevel stays undefined.
8. README longer than readmeMaxChars → truncated + ends with "[truncated]".
9. recent commits respects commitsCount option.
10. globalThis.fetch is used by default (call new GitHubPublicFetcher() with no fetchImpl, then stub globalThis.fetch via vi.stubGlobal).

B. packages/harness/src/tools/github-public-review-tool-registry.test.ts

Test cases:

1. listAvailable returns one tool with name 'github_public_review'.
2. execute happy path: fetcher.fetchReview resolves → result.status='success', structuredOutput is the review object, output contains "# owner/repo".
3. execute when fetcher throws GitHubPublicFetchError code='not_found' → result.status='error', error.code='not_found', retryable=false.
4. execute when fetcher throws code='rate_limited' → retryable=true.
5. execute on missing owner field → result.status='error', error.code='invalid_request'.
6. The tool registry forwards options.fetcher to receive calls (vi.fn()).

Use vitest. Inject a fake fetcher via the options.fetcher path.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('verify-tests', {
      type: 'deterministic',
      dependsOn: ['write-tests'],
      command:
        'test -f packages/harness/src/tools/github-public-fetcher.test.ts && ' +
        'test -f packages/harness/src/tools/github-public-review-tool-registry.test.ts && ' +
        'grep -Eq "rate_limited|not_found|invalid_request" packages/harness/src/tools/github-public-fetcher.test.ts && echo OK',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-tests', {
      type: 'deterministic',
      dependsOn: ['verify-tests'],
      command: 'npx vitest run packages/harness/src/tools/github-public 2>&1 | tail -100',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-tests', {
      agent: 'impl',
      dependsOn: ['run-tests'],
      task: `Fix any failures from:
{{steps.run-tests.output}}
If green, no-op. Don't loosen assertions. Re-run: npx vitest run packages/harness/src/tools/github-public`,
      verification: { type: 'exit_code', value: '0' },
      retries: 2,
    })
    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-tests'],
      command: 'npx vitest run packages/harness/src/tools/github-public 2>&1 | tail -50',
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -30; echo EXIT=$?',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-typecheck', {
      agent: 'impl',
      dependsOn: ['typecheck'],
      task: `If errors, fix. If EXIT=0, no-op.
{{steps.typecheck.output}}
Re-run: cd packages/harness && npx tsc --noEmit`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-typecheck'],
      command: 'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-review', {
      agent: 'lead',
      dependsOn: ['typecheck-final'],
      task: `Review via: git diff packages/harness/

Verify:
1. globalThis.fetch is used (NOT a top-level fetch import) — Cloudflare Workers requirement. Grep for "import.*fetch" should NOT match.
2. Every Response body is consumed or cancelled. No leaked bodies.
3. GitHubPublicFetchError extends Error and has the documented shape.
4. /repos 404 specifically maps to code='not_found' (not 'unknown').
5. 403 + X-RateLimit-Remaining=0 maps to 'rate_limited' (NOT 'unknown' or 'transport').
6. owner/repo regex validation happens BEFORE any fetch call.
7. README truncation marker is stable (always "\\n[truncated]" at the end when truncated).
8. The tool's structuredOutput is the GitHubPublicReview as-is — no transformation.
9. retryable=true ONLY for rate_limited; not_found / invalid_request are NOT retryable.
10. Version bump is minor.
11. No drive-by edits to unrelated tools.

Edit files directly to fix. Re-run npx vitest run packages/harness/src/tools/github-public + cd packages/harness && npx tsc --noEmit.`,
      verification: { type: 'exit_code', value: '0' },
      retries: 1,
    })
    .step('post-review-final', {
      type: 'deterministic',
      dependsOn: ['lead-review'],
      command:
        'npx vitest run packages/harness/src/tools/github-public 2>&1 | tail -30 && echo --- && ' +
        'cd packages/harness && npx tsc --noEmit 2>&1 | tail -10',
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
  if (result.status === 'failed') process.exit(1);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
