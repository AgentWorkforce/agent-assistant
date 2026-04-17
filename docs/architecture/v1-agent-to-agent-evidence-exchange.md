# V1 Agent-to-Agent Evidence Exchange

Date: 2026-04-16

## Purpose

This document defines how agents exchange evidence over Relay-native communication in the Agent Assistant specialist delegation model. It distinguishes ephemeral chat context from structured evidence, establishes the wire format for Relay messages, and specifies how evidence flows through turn-context into the assistant's visible response.

This is the communication layer companion to [v1-specialist-delegation-boundary.md](v1-specialist-delegation-boundary.md). That doc defines the contracts; this doc defines how those contracts travel between agents and how evidence quality is preserved across the exchange.

---

## Core Distinction: Ephemeral Context vs. Durable Evidence

Agent-to-agent communication carries two fundamentally different kinds of information. Conflating them causes both quality loss and storage waste.

### Ephemeral context

- Coordination messages: "I'm starting investigation," "waiting for API response," status pings
- Chat-style exchanges between coordinator and specialist during a delegation
- Intermediate reasoning that led to a conclusion but is not itself a finding
- Retry/error signals and transport-level metadata

**Lifecycle:** exists only for the duration of the delegation request. Not persisted. Not projected into turn-context. Not visible to the user.

**Transport:** Relay messages on coordination channels. These are fire-and-forget — the coordinator does not need to store them after the delegation completes.

### Structured evidence

- `EvidenceItem` instances within `SpecialistFindings`
- Each carries a typed kind, structured content, confidence score, and source provenance
- May optionally have a `DurableEvidenceRef` pointing to a RelayFile artifact

**Lifecycle:** survives the delegation. Projected into turn-context as enrichment candidates. May be persisted in RelayFile for cross-turn or cross-session reuse.

**Transport:** embedded in the `SpecialistFindings` JSON payload sent as a single Relay message.

### Why this matters

If a coordinator treats specialist chat messages as evidence, it pollutes turn-context with noise. If it treats evidence as ephemeral chat, it loses structured data that could inform synthesis or future turns. The contract enforces the split.

---

## Wire Format

### Relay message envelope

All delegation messages use Relay's standard `sendMessage` / `post` API. The payload is a JSON string in the message `text` field.

```
{
  "from": "sage-coordinator",
  "to": "@sage-github-investigator",      // or channel target
  "text": "<JSON payload>",
  "threadId": "<requestId for correlation>"
}
```

The Relay message `threadId` is used strictly for transport correlation and is set to the `requestId` from `DelegationRequest`. Conversation context travels separately on `DelegationRequest.conversationId`. This avoids overloading one field with both product-turn semantics and Relay transport semantics.

### Payload discrimination

Every payload has a `type` field for discrimination:

| Type | Direction | Payload |
|---|---|---|
| `delegation_request` | coordinator → specialist | `DelegationRequest` |
| `specialist_findings` | specialist → coordinator | `SpecialistFindings` |
| `delegation_status` | specialist → coordinator | `DelegationStatus` (ephemeral) |

### DelegationStatus (ephemeral, optional)

```typescript
interface DelegationStatus {
  type: 'delegation_status';
  requestId: string;
  specialistName: string;
  phase: 'started' | 'investigating' | 'writing_evidence' | 'finalizing';
  message?: string;
  progressPercent?: number;
  timestamp: string;
}
```

Status messages are informational. The coordinator may use them for timeout decisions or user-facing progress indicators but **must not** treat them as evidence or project them into turn-context.

---

## Evidence Quality Preservation

### Source provenance chain

Every `EvidenceItem` carries an `EvidenceSource` that records where the data came from and when it was fresh. When evidence passes through multiple agents, the source records the **original** provider, not the relaying agent.

```
User question → Coordinator → GitHub Specialist → RelayFile VFS read → EvidenceItem

EvidenceSource:
  provider: 'relayfile'       // where the data was read from
  ref: '/github/repos/AgentWorkforce/relay/pulls/47'
  asOf: '2026-04-16T10:30:00Z'   // when VFS had this data
```

If the specialist falls back to a live GitHub API call:

```
EvidenceSource:
  provider: 'github_api'
  ref: 'AgentWorkforce/relay#47'
  asOf: '2026-04-16T10:32:00Z'   // API response time
```

### Confidence scoring rules

Evidence confidence is the specialist's assessment of how reliable the specific piece of evidence is, independent of the overall findings confidence.

| Score range | Meaning | Example |
|---|---|---|
| 0.9–1.0 | Directly observed, unambiguous | File content read from VFS at known revision |
| 0.7–0.89 | High confidence with minor uncertainty | PR summary synthesized from diff, may miss context |
| 0.5–0.69 | Moderate confidence, inference involved | Search results that partially match the query |
| 0.3–0.49 | Low confidence, significant gaps | Stale VFS data or partial API response |
| 0.0–0.29 | Speculative or very incomplete | Inference from filenames without reading content |

### Evidence deduplication

When a coordinator receives findings from multiple specialists (v1.1), it may receive overlapping evidence. Deduplication rules:

1. Same `source.ref` + same `kind` → keep the one with higher confidence
2. Same `durableRef.path` → keep the one with newer `durableRef.revision`
3. Different perspectives on the same entity → keep both, flag as complementary

In v1 (single specialist), deduplication is not needed but the contract supports it for forward compatibility.

---

## Turn-Context Projection

### Evidence → Enrichment mapping

Each `EvidenceItem` from `SpecialistFindings` maps to a `TurnEnrichmentCandidate` for turn-context assembly:

```typescript
function evidenceToEnrichment(
  evidence: EvidenceItem,
  findings: SpecialistFindings,
): TurnEnrichmentCandidate {
  return {
    id: `evidence:${findings.requestId}:${evidence.id}`,
    kind: mapEvidenceKindToEnrichmentKind(evidence.kind),
    source: findings.specialistName,
    content: evidence.content.body,
    importance: confidenceToImportance(evidence.confidence),
    structured: evidence.content.structured,
    metadata: {
      evidenceKind: evidence.kind,
      sourceProvider: evidence.source.provider,
      sourceRef: evidence.source.ref,
      sourceAsOf: evidence.source.asOf,
      durablePath: evidence.durableRef?.path,
    },
  };
}

function mapEvidenceKindToEnrichmentKind(kind: EvidenceKind): string {
  switch (kind) {
    case 'code_snippet':
    case 'file_content':
    case 'diff_analysis':
      return 'specialist_code_evidence';
    case 'pr_summary':
    case 'issue_summary':
      return 'specialist_entity_summary';
    case 'search_results':
      return 'specialist_search_results';
    default:
      return 'specialist_memo';
  }
}

function confidenceToImportance(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}
```

### Gaps → enrichment metadata

`FindingsGap` entries are not projected as enrichment candidates (they are absences, not information). Instead, they are attached as metadata on the findings-level enrichment so the synthesizer can acknowledge what wasn't found:

```typescript
function gapsToSynthesisContext(gaps: FindingsGap[]): string {
  if (gaps.length === 0) return '';
  return gaps
    .map(g => `[Gap] ${g.description} (${g.reason})`)
    .join('\n');
}
```

### Recommended actions → coordinator signals

`RecommendedAction` entries are not projected into turn-context. They are consumed by the coordinator to decide whether to:

1. Delegate to another specialist (v1.1)
2. Ask the user for clarification (via continuation `needs_clarification`)
3. Escalate (via connectivity `escalation.uncertainty` signal)
4. Proceed to synthesis with available evidence

---

## Connectivity Signal Emission

After receiving `SpecialistFindings`, the coordinator emits signals on the `ConnectivityLayer`:

| Condition | Signal class | Priority |
|---|---|---|
| `confidence.score >= 0.8` | `confidence.high` | `normal` |
| `confidence.score >= 0.5` | `confidence.medium` | `normal` |
| `confidence.score >= 0.3` | `confidence.low` | `high` |
| `confidence.score < 0.3` | `confidence.blocker` | `critical` |
| `status === 'failed'` | `escalation.interrupt` | `critical` |
| `status === 'partial'` with gaps | `escalation.uncertainty` | `high` |
| `recommendedNext` includes `delegate` | `handoff.ready` | `normal` |

These signals are observable by other coordination participants and by the routing layer (when the escalation-routing pipeline is wired in v1.1).

---

## Serialization Guarantees

1. All payloads are JSON-serializable. No functions, symbols, or circular references.
2. `EvidenceContent.body` is always a string. Binary content must be base64-encoded with `contentType: 'application/json'` wrapping the encoded form, or stored as a RelayFile artifact with only the `durableRef` in the findings.
3. Maximum payload size for a single `SpecialistFindings` message: 256 KB. Evidence exceeding this must use RelayFile durable refs for large artifacts.
4. Timestamps use ISO 8601 format with timezone offset.
5. `requestId` is used for correlation across all messages in a delegation exchange.

---

## What This Does Not Cover

- **Authentication between agents** — Relay foundation handles this via workspace auth and agent identity
- **Message ordering guarantees** — Relay provides at-least-once delivery; the delegation protocol is request/response, so ordering within a single delegation is implicit
- **Multi-specialist fan-out** — deferred to v1.1; this doc covers single-specialist exchange only
- **Evidence retention policy** — when RelayFile artifacts expire or are cleaned up is a product concern, not an SDK concern

---

V1_AGENT_TO_AGENT_EVIDENCE_EXCHANGE_READY
