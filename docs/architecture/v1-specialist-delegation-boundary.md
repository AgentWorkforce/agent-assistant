# V1 Specialist Delegation Boundary

Date: 2026-04-16

## Purpose

This document defines the first bounded specialist-delegation boundary for Agent Assistant. It specifies how a coordinator delegates investigation work to a specialist agent over Relay-native communication, how results flow back as structured evidence, and where the boundary sits between Agent Assistant SDK, Relay foundation, and product code.

This is **not** a universal multi-agent framework. It is the narrowest useful slice: one coordinator delegates to one specialist at a time, receives structured findings, and synthesizes a response. Fan-out to multiple specialists and parallel delegation are explicitly deferred to v1.1.

---

## Scope

### In scope (v1)

- Typed delegation request and structured findings response contracts
- Relay-native agent-to-agent message exchange for delegation (not internal function calls)
- Evidence-carrying specialist results that distinguish structured data from natural-language summary
- RelayFile-backed durable evidence artifacts alongside ephemeral chat-context findings
- First specialist boundary: GitHub Investigation Specialist (see companion doc)
- Coordinator-side synthesis that consumes structured findings, not only text blobs

### Out of scope (v1)

- Parallel multi-specialist fan-out within a single turn
- Dynamic specialist discovery or marketplace
- Specialist-to-specialist lateral delegation
- Long-running autonomous specialist loops (bounded to single request/response)
- Specialist identity in `@agent-assistant/traits` (specialists are not assistants)

---

## Architecture Layers

### What belongs in Agent Assistant SDK (`@agent-assistant/coordination`)

The coordination package already owns `SpecialistRegistry`, `DelegationPlan`, `DelegationStep`, `SpecialistResult`, and `Synthesizer`. The v1 specialist-delegation boundary extends this with:

1. **`DelegationRequest`** — the typed payload a coordinator sends to a specialist agent over Relay. This is the wire contract, not the internal `DelegationStep`.

2. **`SpecialistFindings`** — the typed payload a specialist returns. This replaces the current `SpecialistResult.output: string` with structured evidence.

3. **`EvidenceItem`** — a single piece of structured evidence within findings, carrying type, content, confidence, source reference, and optional RelayFile path for durable artifacts.

4. **`DelegationTransport`** — an adapter interface that coordinator uses to send a `DelegationRequest` and receive `SpecialistFindings`. Products wire Relay-native messaging into this adapter. The SDK does not import `@agent-relay/sdk` directly.

### What belongs in Relay foundation

- Agent-to-agent message delivery, channel subscription, and connection lifecycle
- The actual `Relay` client SDK (`@agent-relay/sdk/communicate`)
- Webhook, auth, and scheduling substrate

### What remains product-owned

- Which specialists exist and their domain-specific behavior
- Specialist agent system prompts and model selection
- When to delegate vs. answer directly (product routing heuristics)
- The specific Relay workspace, channel names, and agent registration
- Domain-specific synthesis strategies (e.g., Sage merging GitHub findings with web search)

---

## Core Contracts

### DelegationRequest

```typescript
interface DelegationRequest {
  /** Unique request identifier for correlation */
  requestId: string;

  /** Discriminator for Relay payload envelopes */
  type: 'delegation_request';

  /** Coordinator's turn context */
  turnId: string;
  conversationId: string;
  assistantId: string;

  /** What the specialist should investigate */
  intent: string;
  instruction: string;

  /** Structured parameters the specialist can act on */
  parameters: Record<string, unknown>;

  /** Constraints on the specialist's execution */
  bounds: DelegationBounds;

  /** Optional: prior findings from earlier steps for context */
  priorFindings?: SpecialistFindings[];
}

interface DelegationBounds {
  /** Maximum wall-clock time before the coordinator gives up */
  timeoutMs: number;

  /** Maximum number of tool calls / API requests the specialist should make */
  maxActions?: number;

  /** Whether the specialist may write durable artifacts to RelayFile */
  allowDurableEvidence: boolean;
}
```

### SpecialistFindings

```typescript
interface SpecialistFindings {
  /** Correlation back to the request */
  requestId: string;

  /** Discriminator for Relay payload envelopes */
  type: 'specialist_findings';

  /** Which specialist produced this */
  specialistName: string;
  specialistVersion?: string;

  /** Overall assessment */
  status: 'complete' | 'partial' | 'failed';
  confidence: SpecialistConfidence;

  /** The structured evidence collected */
  evidence: EvidenceItem[];

  /** Natural-language summary for synthesis (not the only output) */
  summary: string;

  /** What the specialist could not determine */
  gaps: FindingsGap[];

  /** Suggested follow-up actions or specialists */
  recommendedNext: RecommendedAction[];

  /** Execution metadata */
  metadata: FindingsMetadata;
}

interface SpecialistConfidence {
  /** 0.0–1.0 overall confidence in the findings */
  score: number;

  /** Human-readable rationale for the confidence level */
  rationale: string;
}

interface FindingsGap {
  /** What information is missing */
  description: string;

  /** Why it couldn't be obtained */
  reason: 'not_found' | 'access_denied' | 'timeout' | 'out_of_scope';

  /** Which specialist or action might fill this gap */
  suggestedResolver?: string;
}

interface RecommendedAction {
  /** What should happen next */
  action: 'delegate' | 'ask_user' | 'escalate' | 'none';

  /** Target specialist name if action is 'delegate' */
  targetSpecialist?: string;

  /** Why this action is recommended */
  rationale: string;

  /** Structured parameters for the next delegation, if applicable */
  parameters?: Record<string, unknown>;
}

interface FindingsMetadata {
  /** Assistant that initiated the delegation and owns the evidence namespace */
  assistantId: string;

  /** Wall-clock duration of specialist execution */
  durationMs: number;

  /** Number of tool/API actions taken */
  actionCount: number;

  /** Number of evidence items that are RelayFile-backed (durable) */
  durableEvidenceCount: number;

  /** Timestamp when findings were produced */
  producedAt: string;
}
```

### EvidenceItem

```typescript
interface EvidenceItem {
  /** Unique identifier within findings */
  id: string;

  /** Evidence classification */
  kind: EvidenceKind;

  /** Human-readable title */
  title: string;

  /** The evidence content — structured data, not just text */
  content: EvidenceContent;

  /** Confidence in this specific piece of evidence */
  confidence: number;

  /** Where this evidence came from */
  source: EvidenceSource;

  /** If this evidence is persisted durably in RelayFile */
  durableRef?: DurableEvidenceRef;
}

type EvidenceKind =
  | 'code_snippet'
  | 'file_content'
  | 'pr_summary'
  | 'issue_summary'
  | 'search_results'
  | 'diff_analysis'
  | 'dependency_info'
  | 'structured_data'
  | 'narrative';

interface EvidenceContent {
  /** MIME type of the content */
  contentType: 'text/plain' | 'text/markdown' | 'application/json';

  /** The actual content */
  body: string;

  /** Optional structured data alongside the body */
  structured?: Record<string, unknown>;
}

interface EvidenceSource {
  /** Where the evidence was obtained from */
  provider: 'relayfile' | 'github_api' | 'web_search' | 'internal';

  /** Provider-specific reference (e.g., file path, URL, PR number) */
  ref: string;

  /** When the source data was last known fresh */
  asOf?: string;
}

interface DurableEvidenceRef {
  /** RelayFile path where the evidence artifact is stored */
  path: string;

  /** RelayFile revision at time of write */
  revision: string;

  /** Workspace the artifact belongs to */
  workspaceId: string;
}
```

### DelegationTransport

```typescript
interface DelegationTransport {
  /**
   * Send a delegation request to a specialist and wait for findings.
   * The transport handles Relay-native message exchange.
   * Rejects with DelegationTimeoutError if bounds.timeoutMs is exceeded.
   */
  delegate(request: DelegationRequest): Promise<SpecialistFindings>;
}
```

Products implement this by wiring `@agent-relay/sdk` messaging. The SDK provides a reference in-memory transport for testing.

---

## Integration with Existing Coordination Package

The existing `@agent-assistant/coordination` types evolve as follows:

### SpecialistHandler (updated)

```typescript
interface SpecialistHandler {
  /** Existing: in-process specialist execution (remains for lightweight specialists) */
  execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
}

interface RemoteSpecialistHandler {
  /** New: Relay-native specialist delegation */
  delegate(request: DelegationRequest, context: SpecialistContext): Promise<SpecialistFindings>;
}
```

A `Specialist` definition gains an optional `remoteHandler` field. When present, the coordinator uses `remoteHandler.delegate()` instead of `handler.execute()`. This is additive — existing in-process specialists continue working.

### SpecialistResult (bridge)

A `SpecialistFindings` can be projected to a `SpecialistResult` for backward compatibility with existing synthesis:

```typescript
function findingsToResult(findings: SpecialistFindings): SpecialistResult {
  return {
    specialistName: findings.specialistName,
    output: findings.summary,
    confidence: findings.confidence.score,
    status: findings.status,
    metadata: {
      evidence: findings.evidence,
      gaps: findings.gaps,
      recommendedNext: findings.recommendedNext,
      ...findings.metadata,
    },
  };
}
```

### Connectivity signal emission

When a specialist returns findings, the coordinator emits connectivity signals:

- `confidence.high` / `confidence.medium` / `confidence.low` / `confidence.blocker` based on `findings.confidence.score`
- `handoff.ready` when findings include `recommendedNext` with `action: 'delegate'`
- `escalation.uncertainty` when findings have `status: 'partial'` with significant gaps

---

## Relay Communication Flow

```
┌──────────────┐                          ┌────────────────────────┐
│  Coordinator  │                          │  Specialist Agent      │
│  (in-product) │                          │  (Relay-connected)     │
└──────┬───────┘                          └──────────┬─────────────┘
       │                                             │
       │  DelegationRequest (JSON via Relay message)  │
       │─────────────────────────────────────────────>│
       │                                             │
       │                              [investigate]  │
       │                              [collect evidence]
       │                              [write durable artifacts]
       │                                             │
       │  SpecialistFindings (JSON via Relay message) │
       │<─────────────────────────────────────────────│
       │                                             │
       │  [project findings → turn-context enrichment]│
       │  [synthesize response]                       │
       │  [emit connectivity signals]                 │
```

The coordinator and specialist are **separate Relay-connected agents**. They communicate via Relay channels with JSON-serialized `DelegationRequest` and `SpecialistFindings` payloads. This is not an internal function call — it is a genuine agent-to-agent exchange.

---

## Turn-Context Integration

Specialist findings flow into `@agent-assistant/turn-context` as enrichment candidates:

```typescript
function findingsToEnrichment(findings: SpecialistFindings): TurnEnrichmentCandidate[] {
  return findings.evidence.map((item) => ({
    id: `evidence:${findings.requestId}:${item.id}`,
    kind: 'specialist_evidence',
    source: findings.specialistName,
    content: item.content.body,
    importance: item.confidence > 0.8 ? 'high' : item.confidence > 0.5 ? 'medium' : 'low',
    structured: item.content.structured,
    metadata: {
      evidenceKind: item.kind,
      sourceProvider: item.source.provider,
      sourceRef: item.source.ref,
      durablePath: item.durableRef?.path,
    },
  }));
}
```

This preserves the existing turn-context composition rules: enrichment informs the assistant's expression for the turn but does not replace identity.

---

## Testing Strategy

1. **Unit tests** — validate contract serialization/deserialization, findings-to-result projection, and enrichment projection
2. **In-memory transport** — SDK ships an `InMemoryDelegationTransport` that wires `delegate()` directly to a registered specialist handler, enabling full coordinator→specialist→synthesis flow without Relay infrastructure
3. **Product integration** — Sage wires `DelegationTransport` to its existing Relay channel infrastructure and registers the GitHub Investigation Specialist

---

## Boundary Enforcement Rules

1. The SDK (`@agent-assistant/coordination`) **never imports** `@agent-relay/sdk`. The `DelegationTransport` interface is the boundary.
2. Specialist agents **are not assistants**. They do not have traits, sessions, or surface attachments. They are task-scoped workers.
3. A specialist **must not** delegate to another specialist in v1. Lateral delegation is a v1.1 concern.
4. Durable evidence artifacts in RelayFile are **opt-in** per request via `bounds.allowDurableEvidence`.
5. The coordinator **must** set a `timeoutMs` bound. There is no unbounded specialist execution.
6. Products own specialist registration, channel topology, and model selection. The SDK owns the contract shape.

---

V1_SPECIALIST_DELEGATION_BOUNDARY_READY
