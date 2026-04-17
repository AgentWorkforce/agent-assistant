# V1 RelayFile-Backed Evidence Contract

Date: 2026-04-16

## Purpose

This document defines how specialist agents use RelayFile as a durable evidence store during delegation. It separates ephemeral evidence (carried in `SpecialistFindings` payloads) from durable evidence (persisted in RelayFile for cross-turn and cross-session reuse) and establishes the contracts for writing, referencing, and reading durable artifacts.

This is the storage layer companion to [v1-specialist-delegation-boundary.md](v1-specialist-delegation-boundary.md) and [v1-agent-to-agent-evidence-exchange.md](v1-agent-to-agent-evidence-exchange.md).

---

## Core Distinction: Ephemeral vs. Durable Evidence

### Ephemeral evidence

- Lives only in the `SpecialistFindings` JSON payload
- Transmitted inline as `EvidenceItem.content.body`
- Suitable for small, turn-scoped evidence: search result snippets, short code fragments, summaries
- No persistence cost, no cleanup burden
- Lost after the coordinator processes the findings (unless projected into memory)

### Durable evidence

- Persisted as a RelayFile artifact at a known path
- Referenced in `EvidenceItem.durableRef` with path, revision, and workspaceId
- Suitable for: full file contents, complete PR diffs, large structured datasets, investigation reports
- Survives the delegation — available to future turns, other specialists, and product code
- Requires explicit opt-in via `DelegationBounds.allowDurableEvidence`

### When to use each

| Evidence type | Size guidance | Recommended storage |
|---|---|---|
| Code snippet (< 2 KB) | Small | Ephemeral (inline in findings) |
| Full file content | Medium–Large | Durable (RelayFile) |
| PR diff | Often large | Durable (RelayFile) |
| Search result list | Small–Medium | Ephemeral |
| Investigation summary | Small | Ephemeral |
| Structured analysis report | Medium | Durable (RelayFile) |
| Dependency graph | Medium–Large | Durable (RelayFile) |

Rule of thumb: if the evidence is over 4 KB or is likely to be useful beyond the current turn, write it durably.

---

## RelayFile Evidence Path Convention

Durable evidence artifacts follow a deterministic path structure:

```
/evidence/{assistantId}/{requestId}/{evidenceId}.{ext}
```

Components:
- `assistantId` — the assistant that initiated the delegation (e.g., `sage`)
- `requestId` — the `DelegationRequest.requestId` for correlation
- `evidenceId` — the `EvidenceItem.id` within the findings
- `ext` — file extension matching the content type:
  - `.md` for `text/markdown`
  - `.json` for `application/json`
  - `.txt` for `text/plain`

Example:
```
/evidence/sage/req-20260416-abc123/pr-47-diff.md
/evidence/sage/req-20260416-abc123/search-results.json
```

### Why this path structure

1. **Scoped by assistant** — prevents cross-assistant collision and enables per-assistant cleanup policies
2. **Scoped by request** — all evidence from one delegation is co-located and can be cleaned up together
3. **Deterministic** — the coordinator can predict the path from the evidence metadata without a lookup

### Index manifest

Each delegation that writes durable evidence also writes a manifest:

```
/evidence/{assistantId}/{requestId}/manifest.json
```

```typescript
interface EvidenceManifest {
  requestId: string;
  assistantId: string;
  specialistName: string;
  producedAt: string;
  items: EvidenceManifestEntry[];
}

interface EvidenceManifestEntry {
  evidenceId: string;
  path: string;
  kind: EvidenceKind;
  contentType: string;
  sizeBytes: number;
  confidence: number;
  title: string;
}
```

The manifest enables enumeration of delegation evidence without reading each artifact.

---

## Specialist Write Contract

### EvidenceWriter interface

Specialists use an `EvidenceWriter` to persist durable evidence. This interface wraps RelayFile writes with the evidence path convention and manifest tracking.

```typescript
interface EvidenceWriter {
  /**
   * Write a single evidence artifact to RelayFile.
   * Returns the DurableEvidenceRef to embed in the EvidenceItem.
   */
  write(input: EvidenceWriteInput): Promise<DurableEvidenceRef>;

  /**
   * Finalize and write the manifest for this delegation.
   * Must be called after all evidence items are written.
   */
  finalize(findings: SpecialistFindings): Promise<void>;
}

interface EvidenceWriteInput {
  requestId: string;
  assistantId: string;
  evidenceId: string;
  kind: EvidenceKind;
  contentType: 'text/plain' | 'text/markdown' | 'application/json';
  content: string;
  title: string;
  confidence: number;
}
```

### Implementation ownership

The `EvidenceWriter` implementation lives in product code, not in the SDK. It wraps `@relayfile/sdk` writes with the path convention. The SDK defines the interface; products provide the implementation.

A reference implementation for Sage:

```typescript
import { RelayFileClient } from '@relayfile/sdk';

function createEvidenceWriter(
  client: RelayFileClient,
  workspaceId: string,
): EvidenceWriter {
  const written: EvidenceManifestEntry[] = [];

  return {
    async write(input) {
      const ext = contentTypeToExt(input.contentType);
      const path = `/evidence/${input.assistantId}/${input.requestId}/${input.evidenceId}.${ext}`;

      const result = await client.writeFile(workspaceId, path, {
        content: input.content,
        contentType: input.contentType,
      });

      const entry: EvidenceManifestEntry = {
        evidenceId: input.evidenceId,
        path,
        kind: input.kind,
        contentType: input.contentType,
        sizeBytes: Buffer.byteLength(input.content),
        confidence: input.confidence,
        title: input.title,
      };
      written.push(entry);

      return {
        path,
        revision: result.revision,
        workspaceId,
      };
    },

    async finalize(findings) {
      const manifestPath = `/evidence/${findings.requestId}/manifest.json`;
      const manifest: EvidenceManifest = {
        requestId: findings.requestId,
        assistantId: findings.metadata?.assistantId ?? 'unknown',
        specialistName: findings.specialistName,
        producedAt: findings.metadata.producedAt,
        items: written,
      };

      await client.writeFile(workspaceId, manifestPath, {
        content: JSON.stringify(manifest, null, 2),
        contentType: 'application/json',
      });
    },
  };
}
```

---

## Coordinator Read Contract

### Reading durable evidence

When a coordinator needs to read durable evidence (e.g., to include full content in synthesis rather than just the summary), it uses the standard `SageRelayFileReader` or equivalent RelayFile read path:

```typescript
async function readDurableEvidence(
  reader: SageRelayFileReader,
  ref: DurableEvidenceRef,
): Promise<string | null> {
  return reader.readFile(ref.path);
}
```

### When to read vs. use inline

The coordinator does **not** need to read every durable artifact. The `EvidenceItem` in `SpecialistFindings` always carries a `content.body` summary alongside the `durableRef`. The inline summary is sufficient for synthesis in most cases.

Read the durable artifact when:
1. The user explicitly asks for full content (e.g., "show me the full diff")
2. The synthesis strategy requires complete data (e.g., structured analysis)
3. A subsequent specialist needs the full artifact as input

---

## Relationship to Existing Sage VFS Patterns

Sage already has a VFS-first read pattern via `SageRelayFileReader`. The evidence contract extends this:

### Existing VFS paths (read-only for specialists)

```
/github/repos/{owner}/{repo}/...     — synced GitHub data
/slack/channels/...                   — synced Slack data
/notion/pages/...                     — synced Notion data
/linear/issues/...                    — synced Linear data
```

These paths are **source data** that specialists read from. They are owned by RelayFile sync infrastructure, not by specialists.

### New evidence paths (specialist-written)

```
/evidence/{assistantId}/{requestId}/... — specialist-produced evidence
```

These paths are **investigation artifacts** produced by specialists. They are distinct from source data:

- Source data is continuously synced by infrastructure
- Evidence artifacts are produced on-demand by specialist investigations
- Source data is authoritative for its provider
- Evidence artifacts are derived analyses with confidence scores

### No cross-contamination

Specialists **must not** write to source data paths (`/github/repos/...`). Evidence artifacts go under `/evidence/` only. Source data sync and evidence production are separate concerns with separate ownership.

---

## Cleanup and Retention

### Product-owned retention policy

The SDK does not define evidence retention. Products decide:

- How long evidence artifacts are kept
- Whether to clean up after a turn completes, a session expires, or on a schedule
- Whether to promote high-value evidence to longer-lived storage

### Suggested defaults for Sage

| Condition | Retention |
|---|---|
| Turn completed, evidence used in synthesis | 24 hours |
| Turn completed, evidence not used | 4 hours |
| Session expired | Clean up all evidence for that session's requests |
| Evidence with `confidence >= 0.9` | Eligible for promotion to knowledge base |

### Cleanup mechanism

Products use the manifest at `/evidence/{assistantId}/{requestId}/manifest.json` to enumerate and delete evidence for a completed delegation. The manifest-based approach avoids expensive directory scans.

---

## Interaction with Inbox and Memory

### Inbox

If a specialist's findings contain evidence that should be treated as an external input for a future turn (e.g., a long-running investigation that finishes after the user's session), the coordinator may project durable evidence into the inbox:

```typescript
const inboxItem: InboxWriteInput = {
  assistantId: 'sage',
  kind: 'trusted_memo',
  source: {
    sourceId: findings.specialistName,
    sourceLabel: `${findings.specialistName} investigation`,
    trustLevel: 'verified',
    producedAt: findings.metadata.producedAt,
  },
  content: findings.summary,
  structured: {
    evidenceManifestPath: `/evidence/sage/${findings.requestId}/manifest.json`,
    evidenceCount: findings.evidence.length,
    confidence: findings.confidence.score,
  },
  title: `Investigation: ${findings.requestId}`,
  tags: ['specialist-findings'],
};
```

This is opt-in and product-decided. Most same-turn findings do not need inbox projection.

### Memory

Evidence-derived insights (not the raw evidence) may be promoted to memory via existing `@agent-assistant/memory` contracts. For example, "PR #47 has 2 critical issues" is a memory-worthy fact; the full diff that led to that conclusion is not.

The specialist does not write to memory directly. The coordinator decides what to promote after synthesis.

---

## Boundary Rules

1. The SDK defines `EvidenceWriter` and `DurableEvidenceRef` interfaces. Products implement the writer.
2. Specialists write to `/evidence/` paths only. Never to source data paths.
3. Durable evidence is opt-in per delegation via `DelegationBounds.allowDurableEvidence`.
4. The manifest is required when any durable evidence is written.
5. Cleanup is product-owned. The SDK provides no automatic cleanup.
6. The SDK does not import `@relayfile/sdk`. The `EvidenceWriter` interface is the boundary.

---

V1_RELAYFILE_BACKED_EVIDENCE_CONTRACT_READY
