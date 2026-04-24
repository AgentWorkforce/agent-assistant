# GitHub VFS Spec

Status: IMPLEMENTATION_READY
Package: `@agent-assistant/github-vfs`

## Purpose

`@agent-assistant/github-vfs` is the shared GitHub layer that sits on top of `@agent-assistant/vfs`. It owns the path conventions, query helpers, intent detection, and harness tool registration needed to answer GitHub pull-request questions deterministically from RelayFile-synced VFS metadata.

The package owns:
- the `/github/repos/{owner}/{repo}/pulls/...` path grammar
- typed helpers that turn metadata JSON files into `GitHubPullRequestSummary` records
- intent helpers that recognize narrow open-PR list questions in user prompts
- a workspace-level harness tool (`workspace_github_list_open_prs`) that products can plug into a `HarnessToolRegistry`

The package does not own:
- the GitHub API client or auth
- RelayFile sync semantics
- Slack, Discord, CLI, or other product surfaces (callers cite `sourcePath` and format their own replies)
- write paths (create/update/close PRs, comments, reviews)

## Goals

1. Give every assistant product the same deterministic answer for "what open PRs exist in `<owner>/<repo>`" without each product re-parsing VFS paths.
2. Keep the typed surface narrow so it composes with `@agent-assistant/vfs` providers.
3. Make intent detection conservative — never invent a repo, never match investigative or filtered queries.
4. Expose a single harness tool that callers can register alongside other workspace tools.

## Path Conventions

All paths are produced by helper functions; consumers should not hand-build them.

- Pulls root: `/github/repos/{owner}/{repo}/pulls`
- Pull metadata file: `/github/repos/{owner}/{repo}/pulls/{number}/metadata.json`
- A path is recognized as pull metadata when it matches `/github/repos/<owner>/<repo>/pulls/<number>/(meta|metadata).json` (case-insensitive).

`owner` and `repo` segments are URL-encoded by the helpers so unusual characters do not break path matching downstream.

## Exported API

```ts
// path helpers
githubPullsRoot(owner: string, repo: string): string;
githubPullMetadataPath(owner: string, repo: string, number: number): string;
isGithubPullMetadataPath(path: string): boolean;
isGithubPullMetadataEntry(entry: VfsEntry): boolean;

// queries
listOpenPullRequestsFromVfs(
  provider: VfsProvider,
  ref: { owner: string; repo: string },
  options?: { limit?: number },
): Promise<GitHubPullRequestSummary[]>;

// intent detection
parseGitHubRepoRefFromText(text: string): GitHubRepoRef | null;
detectOpenPrListIntent(text: string): GitHubRepoRef | null;

// harness tool registry
createGithubVfsToolRegistry(options: { provider: VfsProvider }): HarnessToolRegistry;
GITHUB_LIST_OPEN_PRS_TOOL_NAME = 'workspace_github_list_open_prs';
```

### Query semantics

- Reads each candidate metadata file under the pulls root using `provider.list` with `depth: 2` and `limit: max(limit*2, limit)`.
- Filters to entries whose path matches `isGithubPullMetadataEntry`.
- Parses each metadata file as JSON; only entries with a numeric `number`, non-empty `title`, and `state === 'open'` (case-insensitive) are kept.
- Sorts the full set by `updatedAt` descending (ties broken by `number` descending) and only then slices to the requested `limit`.
- The default limit is 50 and the maximum is 100.
- Each summary preserves `sourcePath` so callers can cite the exact VFS file they relied on.

### Intent detection semantics

`parseGitHubRepoRefFromText` resolves a repo reference using the following precedence:

1. `repo:owner/name` explicit token.
2. The first `owner/name` token immediately following an anchor word (`in`, `for`, `on`, `of`, `from`).
3. Fallback: the first `owner/name`-shaped token anywhere in the text.

This ordering ensures phrases like `"list open PRs in packages/specialist-worker in AgentWorkforce/cloud"` resolve to `AgentWorkforce/cloud`, not `packages/specialist-worker`.

`detectOpenPrListIntent` is intentionally conservative. It returns `null` for:
- prompts that contain prompt-injection language (`ignore (all|previous|...) instructions`)
- investigative or analytic queries (`investigate`, `analyze`, `review`, `summari[sz]e`, `why`, `risk`, `root cause`, `plan`)
- queries with content predicates (`that`, `with`, `touching`, `about`, `containing`)
- queries that scope by a path-shaped filter (e.g. `for packages/foo/bar in owner/repo`)
- queries missing the literal `(list|show|which|what)` + `open` + `(prs|pull requests)` shape

When the intent matches, it delegates to `parseGitHubRepoRefFromText` for the final repo ref.

### Harness tool

`createGithubVfsToolRegistry` returns a `HarnessToolRegistry` that exposes a single tool:

- name: `workspace_github_list_open_prs`
- input schema: `{ owner: string (required), repo: string (required), limit?: integer in [1, 100] }`
- output: JSON object `{ repo: "owner/repo", pulls: GitHubPullRequestSummary[] }`
- error codes:
  - `unknown_tool` — non-retryable, registry was called for a tool it does not own
  - `invalid_input` — non-retryable, schema validation failed
  - `tool_error` — retryable, underlying `provider` call threw

The tool is intended to be merged into a workspace-level `HarnessToolRegistry` alongside other read-only inspection tools.

## Intended Consumers

- `sage` — Slack and CLI surfaces that already speak to a RelayFile-synced VFS provider.
- Any harness-driven assistant product that wants a typed open-PR list without re-implementing path parsing.

## Out of Scope

- Write operations (creating PRs, comments, reviews).
- Other GitHub resources (issues, releases, workflow runs) — these may be added later behind separate exports once consumers prove the need.
- Provider implementations or auth — those continue to live with the RelayFile sync layer.

GITHUB_VFS_SPEC_IMPLEMENTATION_READY
