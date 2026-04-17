# v1 Specialists Spec — `@agent-assistant/specialists`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-17
**Package:** `@agent-assistant/specialists`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / wave-2 once GitHub investigator + librarian land

---

## 1. Responsibilities

`@agent-assistant/specialists` ships concrete, deterministic specialist implementations that products can register into any `@agent-assistant/coordination` registry. Specialists here are code, not prompts: they read structured data (currently via `VfsProvider`) and return structured findings. An LLM is not in the inner loop.

The package is the home for **integration-domain** specialists — agents that operate against synced workspace data (GitHub, and later Linear / Slack / Notion). It complements — it does not replace — persona-driven LLM agents (which live in the `workforce` repo) and the SDK contract packages (`@agent-assistant/coordination`, `@agent-assistant/vfs`).

**Owns:**
- `createGitHubInvestigator({ vfs, apiFallback? })` — single-PR deep dive. Returns `SpecialistFindings` with structured `pr-meta` + `pr-diff` evidence.
- `createGitHubLibrarian({ vfs, apiFallback? })` — enumeration over PRs / issues / repos. Filters by `state`, `repo`, `label`, `type` parsed from a natural-language or key:value instruction.
- Shared contract: `DelegationRequest`, `SpecialistFindings`, `DelegationTransport`, `DelegationTimeoutError`, `parseQuery` filter-syntax parser, `matchesFilters` VFS adapter helper.
- Typed capability discriminators: `GitHubInvestigationParams` (`pr_investigation` | `github.investigate`) and `GitHubEnumerationParams` (`github.enumerate`).
- Pure evidence shapes compatible with `SpecialistResult.metadata.findings` — consumers read rich structured fields without breaking the `coordination` `SpecialistResult` contract.

**Does NOT own:**
- The `Specialist` / `Coordinator` / `SpecialistRegistry` contracts (→ `@agent-assistant/coordination`).
- VFS contracts or providers (→ `@agent-assistant/vfs`). Specialists consume a `VfsProvider`; they do not implement one.
- GitHub API access (→ consumer-provided `apiFallback`; specialists only read the VFS by default).
- Persona prompts, model selection, or tier routing (→ `workforce` personas + `@agent-assistant/routing`).
- Relay transport. Transport lives with the consumer (e.g. Sage's `RelayDelegationTransport`). The package defines the `DelegationTransport` interface only.
- Durable evidence storage. Specialists accept an optional `EvidenceWriter` and call it when evidence exceeds a threshold; the concrete writer is consumer-owned.

---

## 2. Non-Goals

- No LLM prompt catalog. Persona prompts belong in `workforce/personas/*.json`. If a capability needs an LLM, it should live there and call into these specialists as tools.
- No data syncing. The VFS is populated by other adapters (e.g. `@relayfile/adapter-github`); specialists only read.
- No cross-integration synthesis. A specialist owns one integration at a time. Cross-cutting analysis is the coordinator's job.
- No retry / timeout / circuit-breaker policy. The transport / coordinator owns those. Specialists raise errors truthfully and let upstream decide.
- No capability invention. Capability literals must match `types.ts` discriminators; specialists never emit ad-hoc strings.

---

## 3. GitHub VFS contract

The GitHub specialists read from the canonical VFS layout defined by `@relayfile/adapter-github/path-mapper`:

| Object | Path |
|---|---|
| PR metadata | `/github/repos/{owner}/{repo}/pulls/{n}/metadata.json` |
| Issue metadata | `/github/repos/{owner}/{repo}/issues/{n}/metadata.json` |
| Repository metadata | `/github/repos/{owner}/{repo}/metadata.json` |

Investigator falls back to legacy paths (`meta.json`, `pr.md`, `pr.txt`, `summary.md`, `diff.patch`) so pre-adapter VFS data still works, but the adapter-canonical path is always tried first.

Properties on VFS entries (used for librarian filter matching) are expected to follow the adapter's `mapPRProperties` / `mapIssueProperties` schema — `state`, `repo`, `label`/`labels`, `number`, `title`, `url`, `updated_at`.

---

## 4. Interfaces and contracts

### 4.1 Capability discriminators

```typescript
export type GitHubInvestigationCapability = 'pr_investigation' | 'github.investigate';
export type GitHubEnumerationCapability = 'github.enumerate';
```

Capability literals round-trip cleanly between request (`params.capability`), specialist registration (`Specialist.capabilities`), and findings (`SpecialistFindings.capability`) so delegation routers can correlate by string.

### 4.2 `createGitHubInvestigator`

```typescript
function createGitHubInvestigator(deps: {
  vfs: VfsProvider;
  apiFallback?: GitHubApiFallback | null;
  evidenceWriter?: EvidenceWriter | null;
  now?: () => number;
}): Specialist;
```

Returns a `Specialist` that reads a PR's metadata + diff from the VFS, extracts structured fields, and emits two evidence items (`pr-meta`, `pr-diff`). Diffs exceeding 4 KB are written to the optional `EvidenceWriter` and replaced inline with a durable reference.

### 4.3 `createGitHubLibrarian`

```typescript
function createGitHubLibrarian(options: {
  vfs: { list?: ...; search?: ... };
  apiFallback?: (request) => Promise<readonly VfsEntry[]> | { list?; search? };
}): GitHubLibrarianSpecialist;
```

Handler parses the instruction with `parseQuery`, infers filter values from natural-language cues (`"open"`, `"labeled security"`) and explicit `key:value` tokens, lists or searches the VFS under the adapter-canonical paths, optionally falls back to the caller-supplied API, and returns `evidence[]` where each entry summarizes a match (repo, title, state, labels, snippet).

### 4.4 Functional exports

`investigateGitHub(params, deps)` and `enumerateGitHub(params, options)` are functional entry points that mirror the `create*` specialists for callers that don't want to instantiate a `Specialist`. Both return fully-typed findings and do not throw on known failure modes — they return `failed` findings with gaps instead.

### 4.5 `parseQuery`

```typescript
function parseQuery(input: string): {
  text: string;
  filters: Record<string, string[]>;
};
```

Recognizes `state:`, `repo:`, `label:`, `type:` prefixes. Unknown keys pass through as text so grammar evolves without breaking callers.

---

## 5. Evidence shape

Findings conform to `SpecialistFindings` in `shared/findings.ts`. Each `SpecialistFinding.metadata` carries a stable id (`pr-meta`, `pr-diff`, or an enumeration hit id), a `kind`, optional structured fields, optional `confidence`, and an `EvidenceSource` describing where the data came from (`vfs` vs `github_api` with provenance path/revision). Consumers project findings into `SpecialistResult.metadata.findings` so the `@agent-assistant/coordination` contract is preserved.

---

## 6. Error handling

- VFS read failures are swallowed into an `errors[]` array; the handler returns `partial` or `failed` with a truthful status — it does not throw.
- `apiFallback` calls are wrapped in the same try/catch envelope; a crashing fallback never propagates as an unhandled rejection.
- Structurally invalid requests (missing owner/repo/number for investigation) return `failed` findings with a `invalid_request` gap, never throw.

---

## 7. Dependencies

- `@agent-assistant/coordination@^0.1.0` — `Specialist`, `SpecialistResult`, `SpecialistContext` contracts.
- `@agent-assistant/vfs@^0.2.2` — `VfsProvider`, `VfsEntry`, `VfsReadResult`.
- `@relayfile/adapter-github@^0.1.6` (subpath `path-mapper` only) — canonical GitHub VFS paths. Zero-dep subpath; no SDK pulled at runtime.

No other runtime dependencies. `@relayfile/sdk` is a peer of the adapter but not invoked from the specialists package.

---

## 8. Testing strategy

- Unit tests use inline fake `VfsProvider` implementations; no network, no filesystem, no mocks of third-party modules.
- `query-syntax.test.ts` covers the filter-syntax grammar (bare text, mixed tokens, repeated keys, unknown keys).
- `investigator.test.ts` covers VFS-hit and VFS-miss paths for single-PR investigation.
- `librarian.test.ts` covers filter matching (`state:open`, `state:open label:security`, `type:pr repo:foo/bar`).
- Consumer E2E (owned by the consumer, not this package): Sage spawns the specialist process over `@agent-relay/sdk/communicate`, posts a `DelegationRequest`, asserts `SpecialistFindings` arrive with ≥1 evidence item.

---

## 9. Roadmap

**v0.1.x — current**: GitHub investigator + librarian.

**v0.2 — Linear specialists**: `linearIssueInvestigator` (single-issue deep dive), `linearLibrarian` (enumerate issues/projects/roadmaps). Reuses `parseQuery`, adds Linear path-mapper once `@relayfile/adapter-linear` exposes one.

**v0.3 — Slack + Notion**: `slackChannelInvestigator`, `notionPageLibrarian`. Both share the capability-discriminator + findings shape.

**v1.0**: Stabilize the capability literal union and evidence schema once at least three integrations are implemented, so downstream coordinators can pin against a stable contract.
