# V1 GitHub Investigation Specialist Boundary

Date: 2026-04-16

## Purpose

This document defines the first concrete specialist in the Agent Assistant delegation model: the **GitHub Investigation Specialist**. It specifies what this specialist does, how it receives requests, what evidence it returns, and where the boundary sits between SDK contracts, Sage-owned implementation, and cross-product reuse.

This specialist is intentionally narrow. It handles structured GitHub investigation tasks — not arbitrary code generation, not PR review workflows, not issue triage policies. Those are product orchestration concerns above the specialist boundary.

---

## What the GitHub Investigation Specialist Does

### Capabilities

| Capability | Description | V1 Status |
|---|---|---|
| `pr_investigation` | Read a PR (diff, description, comments, review status), produce structured evidence | Active proving scope |
| `issue_investigation` | Read an issue (body, labels, timeline, linked PRs), produce structured evidence | Future, not active in v1 |
| `code_search` | Search code across repos, return structured search results with snippets | Future, not active in v1 |
| `file_read` | Read specific files at specific refs, return content as evidence | Future, not active in v1 |
| `repo_exploration` | List repo structure, identify relevant files, map dependencies | Future, not active in v1 |

### Non-capabilities (out of scope)

- Writing code, creating PRs, or modifying issues
- PR review judgment (approve/reject/request-changes) — that's product policy
- Issue triage or labeling — that's product workflow
- Cross-provider investigation (Slack, Notion, Linear) — separate specialists
- Arbitrary web search — separate specialist

---

## VFS-First with API Fallback

The specialist follows the same data access pattern already proven in Sage's `SageRelayFileReader`: read from RelayFile VFS first, fall back to live GitHub API when VFS data is missing or stale.

### Data access hierarchy

```
1. RelayFile VFS (fast, local, continuously synced)
   └── hit → use as evidence, record source as 'relayfile'
   └── miss → proceed to step 2

2. Live GitHub API via Nango (authoritative, slower, rate-limited)
   └── hit → use as evidence, record source as 'github_api'
   └── miss → record as gap with reason 'not_found'

3. Clone request (fire-and-forget, prepares VFS for future reads)
   └── if VFS miss, request clone so data is available next time
```

### VFS-only mode

When `SAGE_GITHUB_VFS_ONLY=true` or no GitHub API credentials are configured, the specialist operates in VFS-only mode. API fallback is skipped. VFS misses become gaps in findings with `reason: 'not_found'` and `suggestedResolver: 'retry_after_sync'`.

---

## Request Contract

The coordinator sends a `DelegationRequest` with parameters structured for GitHub investigation:

```typescript
interface GitHubInvestigationParams {
  /** Which capability to invoke */
  capability: 'pr_investigation' | 'issue_investigation' | 'code_search' | 'file_read' | 'repo_exploration';
  // v1 implementation must only execute `pr_investigation`; the others are future capability shapes.

  /** Repository context — at least owner/repo for targeted operations */
  repo?: { owner: string; repo: string };

  /** Capability-specific parameters */
  pr?: { number: number };
  issue?: { number: number };
  search?: { query: string; repo?: string };
  file?: { path: string; ref?: string };
  explore?: { path?: string; depth?: number };
}
```

Example delegation request for PR investigation:

```typescript
const request: DelegationRequest = {
  requestId: 'req-20260416-pr47',
  type: 'delegation_request',
  turnId: 'turn-abc',
  conversationId: 'thread-xyz',
  assistantId: 'sage',
  intent: 'Investigate PR #47 in AgentWorkforce/relay',
  instruction: 'Read the PR diff, description, and review status. Identify critical issues and provide a structured summary.',
  parameters: {
    capability: 'pr_investigation',
    repo: { owner: 'AgentWorkforce', repo: 'relay' },
    pr: { number: 47 },
  },
  bounds: {
    timeoutMs: 30_000,
    maxActions: 10,
    allowDurableEvidence: true,
  },
};
```

---

## Findings Contract

The specialist returns `SpecialistFindings` with evidence items typed to the investigation:

### PR Investigation Findings

```typescript
// Evidence items for a PR investigation
const findings: SpecialistFindings = {
  requestId: 'req-20260416-pr47',
  specialistName: 'github-investigator',
  specialistVersion: '1.0.0',
  status: 'complete',
  confidence: { score: 0.85, rationale: 'Full diff and description read from VFS; 2 review comments not yet synced' },
  evidence: [
    {
      id: 'pr-meta',
      kind: 'pr_summary',
      title: 'PR #47 metadata and description',
      content: {
        contentType: 'application/json',
        body: JSON.stringify({ title: '...', state: 'open', author: '...', description: '...' }),
        structured: {
          number: 47,
          title: 'Add retry logic to webhook delivery',
          state: 'open',
          author: 'miyaontherelay',
          baseBranch: 'main',
          labels: ['enhancement'],
          reviewStatus: 'changes_requested',
          additions: 142,
          deletions: 23,
        },
      },
      confidence: 0.95,
      source: { provider: 'relayfile', ref: '/github/repos/AgentWorkforce/relay/pulls/47', asOf: '2026-04-16T09:00:00Z' },
    },
    {
      id: 'pr-diff',
      kind: 'diff_analysis',
      title: 'PR #47 diff analysis',
      content: {
        contentType: 'text/markdown',
        body: '## Changes\n- Added retry logic in `src/delivery.ts`\n- New `RetryPolicy` type...',
        structured: {
          filesChanged: ['src/delivery.ts', 'src/types.ts', 'test/delivery.test.ts'],
          riskAreas: [
            { file: 'src/delivery.ts', concern: 'Retry loop has no jitter — potential thundering herd', severity: 'high' },
          ],
        },
      },
      confidence: 0.9,
      source: { provider: 'relayfile', ref: '/github/repos/AgentWorkforce/relay/pulls/47', asOf: '2026-04-16T09:00:00Z' },
      durableRef: { path: '/evidence/sage/req-20260416-pr47/pr-diff.md', revision: 'rev-123', workspaceId: 'ws-sage' },
    },
  ],
  summary: 'PR #47 adds retry logic to webhook delivery. The implementation has 1 high-severity concern: the retry loop lacks jitter, risking thundering herd behavior under load. 3 files changed with 142 additions and 23 deletions.',
  gaps: [
    { description: '2 review comments not yet synced to VFS', reason: 'not_found', suggestedResolver: 'retry_after_sync' },
  ],
  recommendedNext: [
    { action: 'none', rationale: 'Investigation complete. Coordinator can synthesize from available evidence.' },
  ],
  metadata: {
    durationMs: 1200,
    actionCount: 3,
    durableEvidenceCount: 1,
    producedAt: '2026-04-16T10:30:01Z',
  },
};
```

### Key evidence patterns by capability

| Capability | Primary evidence kinds | Typical structured fields |
|---|---|---|
| `pr_investigation` | `pr_summary`, `diff_analysis` | `number`, `state`, `author`, `filesChanged`, `riskAreas` |
| `issue_investigation` | `issue_summary` | `number`, `state`, `labels`, `linkedPRs`, `timeline` |
| `code_search` | `search_results` | `matches[]` with `path`, `snippet`, `lineNumber` |
| `file_read` | `file_content`, `code_snippet` | `path`, `ref`, `language`, `lineCount` |
| `repo_exploration` | `structured_data` | `tree[]` with `path`, `type`, `size` |

---

## SDK vs. Product Ownership

### What belongs in Agent Assistant SDK

- `DelegationRequest`, `SpecialistFindings`, `EvidenceItem` type definitions (in `@agent-assistant/coordination`)
- `DelegationTransport` interface
- `EvidenceWriter` interface
- `DurableEvidenceRef` type
- `findingsToResult()` projection for backward compatibility
- `evidenceToEnrichment()` projection for turn-context
- In-memory test transport
- Evidence kind taxonomy (`EvidenceKind` union type)

### What belongs in Sage (product-owned)

- The actual GitHub Investigation Specialist agent implementation
- Relay agent registration and channel wiring
- `SageRelayFileReader` usage for VFS-first reads
- GitHub API fallback via Nango integration
- Clone request logic for VFS cache warming
- Evidence writer implementation wrapping `@relayfile/sdk`
- Specialist system prompt and model selection
- Decision logic for when to invoke the specialist vs. answer directly
- Domain-specific synthesis strategy for GitHub evidence

### What is reusable by MSD and NightCTO

- The SDK contracts (types, interfaces, projections) — fully reusable
- The VFS-first-with-API-fallback pattern — reusable architecture, product implements its own reader
- The evidence path convention (`/evidence/{assistantId}/{requestId}/...`) — reusable
- The `DelegationTransport` wiring pattern — reusable with different Relay workspaces/channels

MSD could implement its own GitHub specialist focused on PR review workflows. NightCTO could implement one focused on repository health monitoring. Both use the same SDK contracts but with different domain logic.

---

## Sage Integration Path

### From current Sage orchestrator to specialist delegation

Sage currently handles GitHub investigation inline in its swarm orchestrator:

1. Router plans tool calls → `github_read_pr`, `github_search_code`, etc.
2. GitHub tool executor runs VFS reads with API fallback
3. Results concatenated as text strings
4. Synthesizer produces final response

The specialist delegation path refactors step 2:

1. Router plans tool calls (unchanged)
2. **Coordinator sends `DelegationRequest` to GitHub Investigation Specialist via Relay**
3. **Specialist executes VFS reads with API fallback, produces structured `SpecialistFindings`**
4. **Coordinator projects evidence into turn-context enrichment**
5. Synthesizer produces final response with structured evidence context

### Migration strategy

Phase 1 (v1): Run both paths. Specialist handles `pr_investigation` only. Simple tool calls (`github_search_code`, `github_read_file`) remain inline, and `issue_investigation` stays explicitly out of active v1 implementation scope.

Phase 2 (v1.1): Migrate remaining capabilities to the specialist. Remove inline tool execution from the orchestrator.

### Relay channel topology for Sage

```
sage-coordinator  →  sage-github-investigator  (delegation channel)
                  ←  sage-github-investigator  (findings channel)
```

The specialist registers as a Relay agent (`sage-github-investigator`) and listens on its delegation channel. The coordinator sends `DelegationRequest` and waits for `SpecialistFindings` on the findings channel, correlated by `requestId` via Relay `threadId`.

---

## Structured Evidence vs. Natural Language

A critical distinction from the current Sage architecture: the specialist returns **structured evidence**, not only natural-language summaries.

### Current behavior (Sage swarm)

```
[github_read_pr]
Title: Add retry logic to webhook delivery
URL: https://github.com/AgentWorkforce/relay/pull/47
Diff:
+ function retryDelivery(...) { ... }
```

This is a text blob. The synthesizer must re-parse it to extract structure.

### New behavior (specialist delegation)

```typescript
evidence: [{
  kind: 'pr_summary',
  content: {
    contentType: 'application/json',
    body: '{"title": "Add retry logic...", ...}',
    structured: { number: 47, state: 'open', author: '...', riskAreas: [...] }
  }
}]
```

The structured data is machine-readable. The synthesizer can reference `evidence[0].content.structured.riskAreas` directly instead of parsing text.

### Why this matters for products

- **Sage** can build richer synthesis that references specific risk areas, not just summarizes a diff
- **MSD** can build PR review workflows that consume structured PR metadata programmatically
- **NightCTO** can build repository health dashboards from structured evidence without LLM-based extraction

---

## Error Handling

### Specialist errors

| Error condition | Specialist response |
|---|---|
| VFS and API both unavailable | `status: 'failed'`, empty evidence, gap with `reason: 'access_denied'` |
| Timeout approaching | `status: 'partial'`, return evidence collected so far, gap for remaining work |
| Entity not found (PR/issue doesn't exist) | `status: 'complete'`, confidence 1.0, evidence stating entity not found |
| Rate limited by GitHub API | `status: 'partial'`, return VFS evidence, gap with `reason: 'timeout'` |

### Coordinator timeout

If the specialist does not respond within `DelegationBounds.timeoutMs`, the coordinator:

1. Emits `escalation.interrupt` connectivity signal
2. Falls back to inline tool execution if available (graceful degradation)
3. Reports the timeout to synthesis as a gap

---

## Bounded Scope Reminder

This specialist does **one thing**: investigate GitHub entities and return structured evidence. It does not:

- Make judgments about code quality (product policy)
- Decide whether a PR should be merged (product workflow)
- Triage issues (product domain logic)
- Communicate with users (coordinator responsibility)
- Delegate to other specialists (v1.1)

Products build their domain-specific behavior on top of the structured evidence this specialist provides.

---

V1_GITHUB_INVESTIGATION_SPECIALIST_BOUNDARY_READY
