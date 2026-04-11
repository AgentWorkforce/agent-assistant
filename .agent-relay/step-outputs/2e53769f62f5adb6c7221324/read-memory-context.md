---MEMORY SPEC---
# v1 Memory Spec — `@relay-assistant/memory`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Package:** `@relay-assistant/memory`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Roadmap stage:** v1.1 (after core, sessions, surfaces land)

---

## 1. Responsibilities

`@relay-assistant/memory` provides scoped, retrievable, promotable memory across assistant sessions. Memory is not conversation history; it is durable context that survives session boundaries and informs future interactions.

**Owns:**
- `MemoryEntry` — unit of stored context, always associated with a scope
- `MemoryStore` — retrieval, write, and deletion interface; storage backend is injected
- Memory scopes — user, session, workspace, org, object (defined below)
- Retrieval — structured queries by scope, tags, and recency
- Promotion — moving an entry from a narrower scope to a broader one (e.g., session → user)
- Compaction — merging or summarizing multiple entries into fewer, denser entries
- TTL / expiry — entries may declare an expiry; expired entries are excluded from retrieval
- Tagging — arbitrary string tags on entries; used to narrow retrieval queries

**Does NOT own:**
- The strategy for deciding what to write to memory (that is the capability handler's concern)
- The model call that generates compacted summaries (compaction requires a callback; memory does not call a model directly)
- Session lifecycle (→ `@relay-assistant/sessions`)
- Surface delivery (→ `@relay-assistant/surfaces`)
- Routing (→ `@relay-assistant/routing`)
- Policy enforcement on what may be stored (→ `@relay-assistant/policy`)

---

## 2. Non-Goals

- Memory is not a vector store. Retrieval in v1 is structured (scope + tags + recency). Semantic/embedding search is a future concern and will require a separate adapter interface.
- Memory does not implement the compaction LLM call. It provides a `CompactionCallback` interface; the caller provides the model invocation.
- Memory does not sync across distributed instances. Consistency is the storage adapter's responsibility.
- Memory does not own the decision of what to archive when a session expires. It provides a query + bulk-delete interface; the sessions or policy layer drives the archival workflow.
- Memory does not encrypt at rest. Encryption is the storage adapter's responsibility.

---

## 3. Memory Scopes

Scopes are hierarchical. Queries at a broader scope may optionally include entries from narrower scopes (configurable; defaults shown).

| Scope | Key | Description | Default query includes narrower? |
|---|---|---|---|
| `session` | sessionId | Lives for the duration of a session. Narrowest scope. | n/a |
| `user` | userId | Persists across sessions for one user. | Includes session (when sessionId provided) |
| `workspace` | workspaceId | Shared across users in a workspace. | Does not include user by default |
| `org` | orgId | Shared across workspaces in an org. | Does not include workspace by default |
| `object` | objectId + objectType | Attached to a specific domain object (e.g., a ticket, a document). | Independent scope |

Scope keys are opaque strings. Memory does not validate that they correspond to real entities.

A single entry belongs to exactly one scope. Promotion creates a new entry at the broader scope; the original is not deleted unless the caller requests it.

---

## 4. Interfaces and Contracts

### 4.1 `MemoryEntry`

```typescript
export interface MemoryEntry {
  /** Globally unique ID. Assigned by the store on write. */
  id: string;

  /** Scope this entry belongs to. */
  scope: MemoryScope;

  /** Content. Plain text in v1; structured content is a future extension. */
  content: string;

  /**
   * Arbitrary string tags. Used to narrow retrieval (e.g., 'preference',
   * 'fact', 'instruction', 'context').
   */
  tags: string[];

  /** ISO-8601 creation timestamp. */
  createdAt: string;

  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;

  /**
   * ISO-8601 expiry timestamp. If set, store excludes this entry from
   * retrieval after this time. Store does not delete automatically.
   */
  expiresAt?: string;

  /**
   * If this entry was promoted from another entry, the source entry's ID.
   * Preserved for audit; does not affect retrieval.
   */
  promotedFromId?: string;

  /**
   * If this entry was produced by compaction, the IDs of source entries.
   * Preserved for audit.
   */
  compactedFromIds?: string[];

  /** Arbitrary key-value metadata for product extensions. */
  metadata: Record<string, unknown>;
}
```

### 4.2 `MemoryScope`

```typescript
export type MemoryScope =
  | { kind: 'session'; sessionId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'object'; objectId: string; objectType: string };
```

### 4.3 `MemoryStore`

```typescript
export interface MemoryStore {
  /**
   * Write a new memory entry. Returns the stored entry with assigned id
   * and timestamps.
   */
  write(input: WriteMemoryInput): Promise<MemoryEntry>;

  /**
   * Retrieve entries matching the query. Excludes expired entries.
   */
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;

  /**
   * Retrieve a single entry by ID. Returns null if not found or expired.
   */
  get(entryId: string): Promise<MemoryEntry | null>;

  /**
   * Update the content and/or tags of an existing entry. Other fields
   * (scope, promotedFromId) are immutable after creation.
   */
  update(entryId: string, patch: UpdateMemoryPatch): Promise<MemoryEntry>;

  /**
   * Delete an entry by ID. Idempotent.
   */
  delete(entryId: string): Promise<void>;

  /**
   * Delete all entries matching the scope. Used during session expiry or
   * workspace teardown. Returns count of deleted entries.
   */
  deleteByScope(scope: MemoryScope): Promise<number>;

  /**
   * Promote an entry to a broader scope. Creates a new entry at the target
   * scope with promotedFromId set. Original entry is not deleted unless
   * deleteOriginal is true.
   */
  promote(input: PromoteMemoryInput): Promise<MemoryEntry>;

  /**
   * Compact multiple entries into one. Calls the provided callback to
   * generate the compacted content; writes the result at the target scope.
   * Source entries are not deleted unless deleteSourceEntries is true.
   */
  compact(input: CompactMemoryInput): Promise<MemoryEntry>;
}
```

### 4.4 `WriteMemoryInput`

```typescript
export interface WriteMemoryInput {
  scope: MemoryScope;
  content: string;
  tags?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.5 `MemoryQuery`

```typescript
export interface MemoryQuery {
  /** Primary scope to query. Required. */
  scope: MemoryScope;

  /**
   * When true, include entries from narrower scopes according to default
   * inclusion rules. E.g., querying user scope with sessionId provided
   * will also include session-scope entries. Defaults to false.
   */
  includeNarrower?: boolean;

  /** Filter to entries that have ALL of the specified tags. */
  tags?: string[];

  /** Return entries created/updated after this ISO-8601 timestamp. */
  since?: string;

  /** Maximum entries to return. Defaults to 20. */
  limit?: number;

  /** Sort order. Defaults to 'newest'. */
  order?: 'newest' | 'oldest';
}
```

### 4.6 `UpdateMemoryPatch`

```typescript
export interface UpdateMemoryPatch {
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}
```

### 4.7 `PromoteMemoryInput`

```typescript
export interface PromoteMemoryInput {
  sourceEntryId: string;
  targetScope: MemoryScope;
  /** If true, delete the source entry after promotion. Defaults to false. */
  deleteOriginal?: boolean;
  /** Override content in the promoted entry. Defaults to source content. */
  content?: string;
  /** Override tags. Defaults to source tags. */
  tags?: string[];
}
```

### 4.8 `CompactMemoryInput`

```typescript
export interface CompactMemoryInput {
  /** IDs of entries to compact. Must be non-empty. */
  sourceEntryIds: string[];

  /** Scope of the resulting compacted entry. */
  targetScope: MemoryScope;

  /**
   * Callback that receives the source entries and returns compacted content.
   * Memory does not call a model; the caller provides this function.
   */
  compactionCallback: CompactionCallback;

  /** If true, delete source entries after compaction. Defaults to false. */
  deleteSourceEntries?: boolean;

  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type CompactionCallback = (
  entries: MemoryEntry[],
) => Promise<string> | string;
```

### 4.9 `MemoryStoreAdapter`

```typescript
/**
 * Storage backend interface. Implementations provide persistence.
 * Memory package never imports a specific storage driver.
 */
export interface MemoryStoreAdapter {
  insert(entry: MemoryEntry): Promise<void>;
  fetchById(entryId: string): Promise<MemoryEntry | null>;
  fetchMany(query: MemoryAdapterQuery): Promise<MemoryEntry[]>;
  update(entryId: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>;
  deleteById(entryId: string): Promise<void>;
  deleteManyByScope(scope: MemoryScope): Promise<number>;
}

/** Internal query shape passed to the adapter after normalization. */
export interface MemoryAdapterQuery {
  scopes: MemoryScope[];
  tags?: string[];
  since?: string;
  excludeExpiredBefore: string; // ISO-8601; adapter filters entries with expiresAt < this value
  limit: number;
  order: 'newest' | 'oldest';
}
```

### 4.10 Error types

```typescript
export class MemoryEntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Memory entry not found: ${entryId}`);
  }
}

export class InvalidScopePromotionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class CompactionError extends Error {
  constructor(
    public readonly sourceEntryIds: string[],
    cause: Error,
  ) {
    super(`Compaction failed for entries [${sourceEntryIds.join(', ')}]: ${cause.message}`);
  }
}
```

---

## 5. `createMemoryStore` Factory

```typescript
export function createMemoryStore(config: MemoryStoreConfig): MemoryStore;

export interface MemoryStoreConfig {
  adapter: MemoryStoreAdapter;

  /**
   * When true, scope inclusion rules (includeNarrower) are applied on the
   * store layer. When false, callers must construct explicit multi-scope
   * queries themselves. Defaults to true.
   */
  applyInclusionRules?: boolean;
}
```

---

## 6. Package Boundaries

### Depends on
- `@relay-assistant/core` — imports `InboundMessage` (optional; used by a convenience utility that extracts session scope from a message).
- `@relay-assistant/sessions` — imports `Session` type to extract scope keys.

### Depended on by
- `@relay-assistant/proactive` — reads memory to find triggers and evidence for proactive actions.
- `@relay-assistant/coordination` — reads shared workspace/org memory for specialist context.
- Product capability handlers (direct consumers).

### Relay foundation boundary
- No dependency on relay foundation. Memory entries are written and read by application code; no relay protocol involved.

---

## 7. Dependency Rules

---PACKAGE BOUNDARY MAP---
# Package Boundary Map

Date: 2026-04-11
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — traits/persona layer added; implementation status reflected; reuse-first rule made explicit)

## Purpose

This document defines what belongs in:

- Relay foundation repos
- `relay-agent-assistant` OSS SDK packages
- product repositories such as Sage, MSD, and NightCTO

The goal is to prevent duplicate assistant-runtime work while avoiding leakage of transport infrastructure or product-specific behavior into the wrong layer.

## Boundary Rule

Use this rule first:

- if the capability is transport, auth, scheduling substrate, or low-level action dispatch, keep it in Relay foundation
- if the capability assumes an assistant identity, memory model, session continuity model, specialist orchestration model, or focused inter-agent connectivity model, move it here
- if the capability only makes sense for one product's domain, keep it in that product repo

**Reuse-first rule for new implementations:** Before authoring a new package implementation workflow, inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities. Only build new assistant-side code where a clear gap exists that is not already satisfied by Relay packages.

---

## Workforce Persona vs. Assistant Traits

These are distinct concerns that solve different problems. Do not conflate them.

**Workforce personas** are runtime execution profiles owned by Workforce infrastructure. A persona defines:
- system prompt
- model
- harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

**Assistant traits** are identity and behavioral characteristics owned by this SDK (future `@relay-assistant/traits` package). Traits define:
- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt is a persona artifact. Traits are the **source data** that prompts, formatters, and behavioral policies read from. Products compose traits into personas, not the other way around.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for the full boundary definition, integration points, and the proposed `@relay-assistant/traits` package spec.

---

## Layer Ownership

### Relay foundation

Relay family repos should continue to own:

- inbound webhook verification and provider-specific parsing
- normalized message and outbound delivery primitives
- channel and transport session substrate
- auth and connection wiring
- low-level action dispatch
- scheduler and wake-up substrate
- relaycast or other communication infrastructure
- transport-level observability

Examples that stay out of this repo:

- Slack signature verification
- WhatsApp payload parsing
- generic cron registration
- raw `spawn_agent` or message-delivery plumbing

### Relay Agent Assistant SDK

This repo should own reusable assistant-runtime behavior:

- assistant definition and capability registration
- assistant identity traits (voice, style, behavioral defaults) — see `@relay-assistant/traits`
- memory scopes, retrieval, persistence contracts, promotion, compaction
- proactive engines, watch rules, reminders, scheduler bindings
- assistant session continuity across surfaces
- assistant-facing surface abstractions above normalized transport events
- coordinator and specialist orchestration
- focused inter-agent connectivity, signaling, and convergence contracts
- assistant-level routing, latency, depth, and budget-aware policy hooks
- policy, approvals, audit hooks, and action risk classification

Examples that should land here:

- a shared `AssistantSession` model
- a reusable `MemoryStore` contract
- a generic `ProactiveEngine`
- a coordinator that can delegate to specialists and synthesize one assistant response

### Product repositories

Product repos should continue to own:

- workforce persona definitions (model, harness, system prompt, tier)
- prompts and persona behavior beyond baseline assistant identity fields
- product-specific tools and workflows
- domain-specific watcher rules
- product UX and surface conventions
- business policy, escalation, and commercial rules
- product-specific specialist definitions

Examples:

- MSD review heuristics and PR-specific workflows
- Sage knowledge-capture behavior and workspace semantics
- NightCTO founder communication patterns and service-tier policy

---

## Package Responsibilities

### `@relay-assistant/core`

**Implementation status: IMPLEMENTED — 44 tests passing, `SPEC_RECONCILED`**

Owns:

- `createAssistant()` and assistant definition types
- runtime lifecycle and capability registration
- assistant identity fields: `id`, `name`, `description?`
- lightweight composition entrypoints and shared cross-package types

Identity scope note:
- `core` owns `id`, `name`, `description?` — the minimum identity fields needed to run an assistant
- Behavioral identity (voice, style, vocabulary, proactivity) will live in `@relay-assistant/traits` when extracted
- `AssistantDefinition` does **not** have a `traits` field yet. When `@relay-assistant/traits` ships in v1.2, a `traits?: TraitsProvider` optional field will be added. Do not add it prematurely — the current types.ts has no such field and that is correct.

Composition note:
- `core` should not become a heavy package that hard-depends on every other package by default
- prefer interface-first composition and optional package wiring so consumers can adopt only the packages they need

Must not own:

- provider-specific transport code
- memory backend implementation details
- product workflows
- workforce persona definitions

### `@relay-assistant/traits` (planned — v1.2)

**Implementation status: NOT IMPLEMENTED — no spec, no types, no placeholder**

Owns:

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

Must not own:

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

Dependency direction: traits has zero upstream dependencies on other SDK packages. It is a leaf data package.

See [traits-and-persona-layer.md](traits-and-persona-layer.md) for full spec.

### `@relay-assistant/memory`

**Implementation status: placeholder — spec exists (`v1-memory-spec.md`, `IMPLEMENTATION_READY`); roadmap: v1.1**

Implementation posture:

- first investigate and reuse the existing `@agent-relay/memory` package where possible
- prefer an assistant-facing adapter/composition layer over a greenfield memory engine
- only add new memory runtime logic here when assistant-specific requirements are not already satisfied by Relay memory capabilities

Owns:

- memory scopes such as user, session, workspace, org, and object
- retrieval, write, compaction, and promotion contracts
- memory adapter interfaces for future backends

Must not own:

- one product's tag taxonomy
- one surface's thread model as the only memory key shape

### `@relay-assistant/proactive`

**Implementation status: placeholder — no formal spec; roadmap: v1.2**

Owns:

- follow-up engines
- watcher definitions
- reminder policies
- scheduler bindings over Relay substrate
- evidence contracts for stale-session or follow-up decisions

Must not own:

- product-only trigger logic
- surface-specific evidence collection that cannot generalize

### `@relay-assistant/sessions`

**Implementation status: IMPLEMENTED — 25 tests passing, `IMPLEMENTATION_READY`**

Owns:

- assistant session identity
- attachment of multiple surfaces to one assistant session
- resume, reattach, and affinity rules
- scoping rules across user, workspace, org, and object contexts

Must not own:

- raw transport sessions
- provider webhook semantics

### `@relay-assistant/surfaces`

**Implementation status: IMPLEMENTED — 28 tests passing, `SPEC_RECONCILED`**

Owns:

- assistant-facing inbound and outbound abstractions
- assistant-layer fanout policy describing which connected surfaces should receive a given assistant response
- formatter and capability hooks above Relay normalization
- surface metadata such as threading or attachment support

Fanout boundary note:
- Relay foundation still owns actual transport delivery to each destination
- `surfaces` only decides assistant-level targeting and formatting across attached surfaces
- Example: deciding that one assistant summary should go to web plus Slack belongs here; the actual Slack API post and web transport delivery remain in Relay foundation

Must not own:

- webhook verification
- provider SDK clients as foundational transport code

### `@relay-assistant/coordination`

**Implementation status: IMPLEMENTED — 45 tests passing**

Owns:

- coordinator and specialist registry contracts
- delegation plan and synthesis contracts
- many-agents-one-assistant orchestration semantics

Known gap (v1): coordinator does not pass `activeEscalations` to `router.decide()`. Escalation-routing pipeline is dormant. Document as v1 known gap; wire in v1.1.

Must not own:

- a fixed specialist lineup for any one product
- product-specific dispatch heuristics that cannot generalize

### `@relay-assistant/connectivity`

**Implementation status: IMPLEMENTED — 87 tests passing, `IMPLEMENTATION_READY`**

Owns:

- focused inter-agent signaling contracts
- convergence and escalation semantics
- attention, salience, confidence, and handoff message classes
- communication efficiency rules for internal assistant coordination

Must not own:

- raw message transport or relaycast substrate
- product-specific specialist registries
- generic user-facing messaging APIs

### `@relay-assistant/routing`

**Implementation status: IMPLEMENTED — 12 tests passing**

**Blocking DoD failure:** routing has 12 tests against a required 40+ target. Do not consume in products until resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

Owns:

- assistant-facing routing contracts
- latency/depth/cost response modes (`cheap`/`fast`/`deep` — SDK vocabulary, distinct from workforce tier names `minimum`/`best-value`/`best`)
- model-choice policy above raw provider clients
- integration points for workforce workload-router style persona/tier resolution

Must not own:

- raw transport routing
- provider SDK implementation details
- product-specific commercial routing rules
- workforce persona names or tier mapping — products map between SDK modes and workforce tiers

### `@relay-assistant/policy`

**Implementation status: placeholder — no formal spec; roadmap: v2**

Owns:

- approval modes
- external-action safeguards
- action risk classification
- audit hooks

Must not own:

- one product's commercial rules or customer-tier behavior

### `@relay-assistant/examples`

**Implementation status: placeholder**

Owns:

- reference examples showing how products should integrate the SDK
- skeletal example assistants and adoption patterns

Must not own:

- production product code
- private cloud adapters

---

## Extraction Guidance From Existing Systems

| Source | Signal | Destination |
| --- | --- | --- |
| Relay gateway and adapter infrastructure | transport, verification, normalization, raw actions | stay in Relay foundation |
| Sage memory and proactive behavior | reusable memory and follow-up patterns | `memory`, `proactive`, parts of `core` |
| Sage identity and communication style | voice, vocabulary, formality | `traits` (v1.2 extraction) |
| MSD session and surface convergence design | shared chat surface and runtime/session attachment | `sessions`, `surfaces`, parts of `core` |
| NightCTO specialist orchestration and per-client continuity | many-agents-one-assistant and proactive monitoring | `coordination`, `connectivity`, `policy`, `memory`, `proactive` |
| NightCTO founder-facing behavior | voice, risk posture, communication style | `traits` (v1.2 extraction) |
| Workforce workload-router and persona tiers | quality-preserving routing across depth/latency/cost envelopes | `routing`, parts of `core`, links to `coordination` |
| Workforce persona library | runtime execution profiles (model, harness, system prompt, tier) | stay in Workforce — NOT imported into SDK |

---

## Import Guidance For Consumers

Consumers should import only the package boundaries they need.

Examples:

- a simple assistant may import `@relay-assistant/core`, `@relay-assistant/sessions`, and `@relay-assistant/surfaces`
- a memory-heavy assistant may additionally import `@relay-assistant/memory`
- a specialist-based assistant may add `@relay-assistant/coordination` and `@relay-assistant/policy`
- an assistant with consistent behavioral identity may add `@relay-assistant/traits` (v1.2)

Consumers should not import Relay infrastructure directly to bypass assistant-level contracts unless they are implementing a transport adapter or other foundational infrastructure outside this repo.

---WORKFLOW BACKLOG---
# V1 Workflow Backlog

Date: 2026-04-11
Revised: 2026-04-11 (post spec-program-review-verdict and spec-reconciliation-rules — aligned to canonical spec vocabulary; fanout/targeting rules and cross-package ownership clarified)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status updated; WF-1 through WF-5 marked COMPLETE; routing DoD gap noted; traits context added)

> **Canonical source of truth:** Package specs in `docs/specs/` override this document when there is drift. This backlog was updated to align with `docs/specs/v1-core-spec.md`, `docs/specs/v1-sessions-spec.md`, and `docs/specs/v1-surfaces-spec.md` after the spec program review and reconciliation rules pass on 2026-04-11.

## Implementation Status Summary

| Workflow | Package(s) | Status | Tests |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | **COMPLETE** | 44 pass |
| WF-2: Handle inbound message via dispatch | core | **COMPLETE** | (included in core 44) |
| WF-3: Create and manage sessions | sessions | **COMPLETE** | 25 pass |
| WF-4: Wire session store into runtime | core + sessions | **COMPLETE** | (included in above) |
| WF-5: Register surface registry and route messages | core + surfaces | **COMPLETE** | 28 pass (surfaces) |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 label, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior |
| WF-7: End-to-end assembly | core + sessions + surfaces | **OPEN** — no assembly test in `packages/examples/src/` (directory not yet created); core/sessions/surfaces READMEs are substantive (not placeholders) |

**Blocking DoD failure (not cleared):** `@relay-assistant/routing` has 12 tests against a required 40+ target. Routing is implemented but is gated from product consumption until this is resolved. See `docs/architecture/v1-routing-review-verdict.md` for F-1 (test count) and F-2 (escalated flag) details.

**Additional implemented packages (beyond WF-1 through WF-5 scope):**
- `@relay-assistant/connectivity` — 87 tests passing
- `@relay-assistant/coordination` — 45 tests passing; routing integration reviewed; escalation-routing pipeline dormant (v1 known gap)

---

## Purpose

This document is the canonical ordered backlog of implementation workflows for v1. Each workflow is a narrow, PR-sized vertical slice through one or more packages. Workflows produce working, testable code and are the unit of implementation work.

Implement in order. Each workflow gates the next unless explicitly noted as parallelizable.

---

## Pre-Workflow: Reconciliation Phase (Complete — WF-1 implementation may begin)

### Spec Phase

Three spec documents are finalized and marked `IMPLEMENTATION_READY`. They are the authoritative implementation reference for all workflow code.

| Spec | Path | Status |
| --- | --- | --- |
| core v1 | `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |
| sessions v1 | `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY |
| surfaces v1 | `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY — `SPEC_RECONCILED` |

### Contradiction Resolutions (Gate cleared — all actions complete)

Three cross-package contradictions identified in `docs/architecture/spec-reconciliation-rules.md` have been resolved in the specs. Both `docs/specs/v1-core-spec.md` and `docs/specs/v1-surfaces-spec.md` carry `SPEC_RECONCILED` status. All eight checklist actions in the reconciliation rules document are complete.

| Action | Target | Contradiction | Status |
| --- | --- | --- | --- |
| 1 | `docs/specs/v1-core-spec.md`: remove "owns inbound normalization" from §1; update `RelayInboundAdapter` to accept `InboundMessage` (not `raw: unknown`) | 1 — inbound normalization ownership | **Resolved** — `SPEC_RECONCILED` |
| 2 | `docs/specs/v1-core-spec.md §3.3`: add `userId: string` (required) and `workspaceId?: string` (optional) to `InboundMessage` | 2 — missing identity fields | **Resolved** — `SPEC_RECONCILED` |
| 3 | `docs/specs/v1-core-spec.md §3.8`: make `OutboundEvent.surfaceId` optional (`surfaceId?`); add `OutboundEventError` | 3 — required surfaceId vs. fanout | **Resolved** — `SPEC_RECONCILED` |
| 4 | `docs/specs/v1-core-spec.md`: add normative outbound routing rule to `runtime.emit()` contract | 3 | **Resolved** — `SPEC_RECONCILED` |
| 5 | `docs/specs/v1-surfaces-spec.md`: confirm `SurfaceRegistry` implements `RelayInboundAdapter`; add `userId`/`workspaceId` to normalization table §4.10 | 1, 2 | **Resolved** — `SPEC_RECONCILED` |
| 6 | `docs/specs/v1-surfaces-spec.md`: add normative outbound routing rule reference | 3 | **Resolved** — `SPEC_RECONCILED` |
| 7 | Update adoption examples in `docs/workflows/weekend-delivery-plan.md` to match resolved contracts | all | **Resolved** |
| 8 | Search all docs for stale terms (Rule 1 table); replace with current terms | all | **Resolved** |

### Key canonical terms (do not use old planning vocabulary)

- `AssistantDefinition` (not `AssistantConfig`)
- `AssistantRuntime` (not `Assistant`)
- `runtime.dispatch()` (not `handleMessage`)
- `InboundMessage` / `OutboundEvent` (not `AssistantMessage`)
- `createSurfaceRegistry()` + `SurfaceConnection` (not `createSurfaceConnection()`)
- `sessionStore.touch()` / `sessionStore.expire()` (not `resume` / `close`)
- Session states: `created → active → suspended → expired` (not `resumed` or `closed`)
- `surfaceRegistry` wired as both `inbound` and `outbound` relay adapter (not `assistant.attachSurface()`)

---

## WF-1: Define assistant and start runtime — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — 44 tests passing, `SPEC_RECONCILED`
**Depends on:** `docs/specs/v1-core-spec.md` (`SPEC_RECONCILED` — Contradiction 1–3 resolutions applied)
**Produces:** `AssistantDefinition`, `AssistantRuntime`, `createAssistant`, lifecycle state machine, `runtime.status()`
**PR scope:** `packages/core/src/types.ts`, `packages/core/src/core.ts`, `packages/core/src/core.test.ts`

### Steps

1. Define an `AssistantDefinition` with `id`, `name`, and a `capabilities` map (`Record<string, CapabilityHandler>`)
2. Call `createAssistant(definition, { inbound: stubAdapter, outbound: stubAdapter })` — returns `AssistantRuntime`
3. Call `runtime.start()` — verify `runtime.status().ready === true`
4. Call `runtime.stop()` — verify runtime is no longer accepting dispatches
5. Verify double-start is idempotent or throws expected error
6. Verify double-stop is idempotent or throws expected error

### Acceptance criteria

- `AssistantDefinition` interface is defined and exported from `packages/core/src/index.ts`
- `AssistantRuntime` interface is defined and exported
- `createAssistant` factory is exported; it validates `definition` and throws `AssistantDefinitionError` on invalid input
- `runtime.status()` returns `RuntimeStatus` reflecting `ready`, `startedAt`, `registeredCapabilities`, `registeredSubsystems`, `inFlightHandlers`
- At least one test exercises the full start/stop cycle with a stub relay adapter
- No network calls, no side effects outside in-memory state
- `RelayInboundAdapter` and `RelayOutboundAdapter` interfaces are exported (with `RelayInboundAdapter.onMessage` accepting `InboundMessage` per Contradiction 1 resolution)

---

## WF-2: Handle inbound message via capability dispatch — **COMPLETE**

**Package:** `core`
**Status:** COMPLETE — included in core 44 tests
**Depends on:** WF-1
**Produces:** capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()`, `InboundMessage` / `OutboundEvent` types
**PR scope:** additions to `packages/core/src/types.ts`, additions to `packages/core/src/core.ts`, new test cases in `packages/core/src/core.test.ts`

### Steps

1. Create and start a runtime with a capability named `"chat"` mapped to a handler function
2. Call `runtime.dispatch(inboundMessage)` where `inboundMessage.capability === "chat"`
3. Verify the `"chat"` handler is called with the correct `InboundMessage` and `CapabilityContext`
4. Handler calls `context.runtime.emit(outboundEvent)` — verify stub outbound adapter receives the event
5. Register an `onMessage` hook that returns `false` — verify dispatch is dropped before handler is called
6. Dispatch a message with an unregistered capability — verify expected error or no-op behavior
7. Verify `runtime.status().inFlightHandlers` tracks concurrent handler invocations

### Acceptance criteria

- `InboundMessage` type is defined and exported with all fields:
  `id`, `surfaceId`, `sessionId?`, `userId` (required — per Contradiction 2 resolution), `workspaceId?` (optional — per Contradiction 2 resolution), `text`, `raw`, `receivedAt`, `capability`
- `OutboundEvent` type is defined and exported:
  `surfaceId?` (optional — per Contradiction 3 resolution), `sessionId?`, `text`, `format?`
- `OutboundEventError` is defined and exported; `runtime.emit()` throws it when both `surfaceId` and `sessionId` are absent
- `CapabilityHandler` type signature matches spec: `(message: InboundMessage, context: CapabilityContext) => Promise<void> | void`
- `CapabilityContext` includes `runtime` and `log`
- `AssistantHooks.onMessage` returning `false` drops the message; `true` or `undefined` proceeds
- `runtime.emit()` calls `RelayOutboundAdapter.send()` with the `OutboundEvent`

---

## WF-3: Create and manage sessions — **COMPLETE**

**Package:** `sessions`
**Status:** COMPLETE — 25 tests passing, `IMPLEMENTATION_READY`
**Depends on:** `docs/specs/v1-sessions-spec.md` (independent of WF-1/WF-2 — parallelizable)
**Produces:** `SessionStore`, `Session`, lifecycle transitions, in-memory `SessionStoreAdapter`, error types
**PR scope:** `packages/sessions/src/types.ts`, `packages/sessions/src/sessions.ts`, `packages/sessions/src/sessions.test.ts`

### Acceptance criteria

- `Session` interface matches spec: `id`, `userId`, `workspaceId?`, `state`, `createdAt`, `lastActivityAt`, `stateChangedAt?`, `attachedSurfaces`, `metadata`
- `SessionState` union type: `'created' | 'active' | 'suspended' | 'expired'`
- `SessionStore` interface fully implemented with `create`, `get`, `find`, `touch`, `attachSurface`, `detachSurface`, `expire`, `sweepStale`, `updateMetadata`
- `createSessionStore` factory exported from `packages/sessions/src/index.ts`
- `InMemorySessionStoreAdapter` exported
- `SessionNotFoundError`, `SessionConflictError`, `SessionStateError` exported
- `AffinityResolver` interface exported; default implementation finds most recently active session for a userId

---

## WF-4: Wire session store into runtime — **COMPLETE**

**Package:** `core` + `sessions`
**Status:** COMPLETE — included in core and sessions test counts
**Depends on:** WF-2, WF-3
**Produces:** `runtime.register('sessions', store)`, session resolution in capability handler context, `resolveSession()` utility integration

> **Cross-package note:** Sessions does not inject session middleware into core's dispatch pipeline. Products wire session lookups into capability handlers themselves using `context.runtime.get<SessionStore>('sessions')` and the `resolveSession()` utility exported by `@relay-assistant/sessions`. Core remains unaware of session semantics.

---

## WF-5: Register surface registry and route messages — **COMPLETE**

**Package:** `core` + `surfaces`
**Status:** COMPLETE — 28 tests passing (surfaces), `SPEC_RECONCILED`
**Depends on:** `docs/specs/v1-surfaces-spec.md`, WF-2
**Produces:** `SurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, inbound normalization, outbound targeted send, connection state management

> **Cross-package ownership note (Contradiction 1 resolution):** Surfaces owns inbound normalization. Core does not normalize raw events; it receives only `InboundMessage`.

---

## WF-6: Multi-surface session fanout — **COMPLETE**

**Package:** `core` + `sessions` + `surfaces`
**Status:** COMPLETE — `packages/core/src/core-sessions-surfaces.test.ts` (WF-6 describe block, line 99) covers multi-surface session attachment, fanout, targeted send, and detach behavior with full assertions.
**Depends on:** WF-4, WF-5
**Produces:** cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout outbound rule validated in integration

> **Fanout ownership note:** The surfaces package owns fanout delivery. When `runtime.emit()` is called with a `sessionId` but without a `surfaceId`, core resolves the session's `attachedSurfaces` and calls `surfaceRegistry.fanout(event, attachedSurfaceIds, policy?)`.

### Steps

1. Create a runtime with sessions and a surface registry (slack + web connections)
2. User sends a message via slack surface — `resolveSession()` creates a new session; `store.attachSurface(sessionId, 'slack-1')` is called
3. Same userId sends a message via web surface — `resolveSession()` returns existing session; `store.attachSurface(sessionId, 'web-1')` is called
4. Verify `session.attachedSurfaces` contains both `'slack-1'` and `'web-1'`
5. Handler emits `OutboundEvent` with `surfaceId` set to originating surface — verify only that surface's adapter receives the event (targeted send via `surfaceRegistry.send()`)
6. Handler emits `OutboundEvent` with `sessionId` but no `surfaceId` — verify `surfaceRegistry.fanout()` is called and both adapters receive the event (session fanout)
7. Handler emits `OutboundEvent` with neither `surfaceId` nor `sessionId` — verify `runtime.emit()` throws `OutboundEventError`
8. Call `store.detachSurface(sessionId, 'slack-1')` — verify fanout no longer includes slack
9. Verify `FanoutResult` reports correct `total`, `delivered`, `outcomes` fields

### Acceptance criteria

- Session correctly accumulates surface references across multiple surface interactions from the same userId
- Targeted send (`surfaceId` present) routes only to the specified adapter via `surfaceRegistry.send()`
- Fanout (`sessionId` present, no `surfaceId`) routes to all `session.attachedSurfaces` via `surfaceRegistry.fanout()`
- Invalid emit (neither `surfaceId` nor `sessionId`) throws `OutboundEventError` (per Contradiction 3 resolution)
- Detach behavior removes surface from fanout targets
- No session duplication for same userId across surfaces
- `FanoutResult` structure is correct per spec

---

## WF-7: End-to-end assembly

**Package:** `core` + `sessions` + `surfaces`
**Status:** OPEN — package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive API docs (not placeholders). However, the end-to-end assembly test in `packages/examples/src/` does not yet exist — `packages/examples/src/` directory has not been created. This is the remaining blocker for WF-7 and the v1 release tag.
**Depends on:** WF-6
**Produces:** integration test, validated assembly pattern, updated package READMEs, v1 release tag prepared
**PR scope:** new file `packages/examples/src/v1-assembly.ts`, new test `packages/examples/src/v1-assembly.test.ts`, updated READMEs for core, sessions, surfaces

### Steps

1. Import only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces` — no other packages
2. Define `AssistantDefinition` with `id`, `name`, `capabilities: { chat: chatHandler }`
3. Create `InMemorySessionStoreAdapter` and `createSessionStore({ adapter })`
4. Create `createSurfaceRegistry()` with slack and web connections (stub adapters)
5. Wire: `createAssistant(definition, { inbound: surfaceRegistry, outbound: surfaceRegistry })`
6. `runtime.register('sessions', sessionStore)`
7. In `chatHandler`: resolve session via `resolveSession(message, store, resolver)` (reads `message.userId`), touch it, emit a response
8. Call `runtime.start()`
9. Simulate inbound message from slack → session created → handler called → response emitted → slack adapter receives `SurfacePayload`
10. Simulate second message from web surface → session reactivated via touch → fanout to both surfaces
11. Call `runtime.stop()` — runtime drains in-flight handlers cleanly
12. Verify `runtime.status()` after stop reflects correct state

### Acceptance criteria

- Full end-to-end cycle passes in a single test with no external dependencies
- Assembly uses only `@relay-assistant/core`, `@relay-assistant/sessions`, `@relay-assistant/surfaces`
- Assembly pattern matches the canonical pattern from `docs/architecture/spec-reconciliation-rules.md §3b`
- The test passes without any cloud, network, or external dependency
- Package READMEs for core, sessions, and surfaces are updated with real API docs replacing placeholder text
- v1 release tag is prepared

---

## Open Routing Issues (gates product consumption of `@relay-assistant/routing`)

These must be resolved before routing is consumed by any product:

| Issue | File | Status |
| --- | --- | --- |
| F-1: routing test count is 12, DoD requires 40+ | `packages/routing/src/routing.test.ts` | **OPEN — blocking** |
| F-2: `escalated` flag incorrect on hard-constraint caps | `packages/routing/src/routing.ts` | **OPEN — blocking** |
| OQ-5: escalation tiebreaker (deepest mode wins) undocumented | `docs/specs/v1-routing-spec.md` | OPEN — moderate |

---

## Dependency Graph

```
[v1-core-spec]    ──→ WF-1 ──→ WF-2 ──┐
                                        ├──→ WF-4 ──┐
[v1-sessions-spec] → WF-3 ─────────────┘            ├──→ WF-6 ──→ WF-7
                                                     │
[v1-surfaces-spec] ──────────────────── WF-5 ────────┘
                                        ↑
                                      (WF-2 for types)
```

---

## Execution Order

| Step | Task | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Apply Contradiction 1–3 resolutions to specs | — | **COMPLETE** |
| 1 | `docs/specs/v1-core-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 2 | `docs/specs/v1-sessions-spec.md` | — | **DONE** |
| 3 | `docs/specs/v1-surfaces-spec.md` | — | **DONE (`SPEC_RECONCILED`)** |
| 4 | Implement WF-1 | core spec | **COMPLETE** |
| 5 | Implement WF-3 | sessions spec | **COMPLETE** |
| 6 | Implement WF-2 | WF-1 | **COMPLETE** |
| 7 | Implement WF-4 | WF-2, WF-3 | **COMPLETE** |
| 8 | Implement WF-5 | surfaces spec, WF-2 (types) | **COMPLETE** |
| 9 | Implement WF-6 | WF-4, WF-5 | **COMPLETE** (`core-sessions-surfaces.test.ts`) |
| 10 | Implement WF-7 | WF-6 | **OPEN** — examples/src not yet created |
| 11 | Update package READMEs | WF-7 | **DONE** — core/sessions/surfaces READMEs are substantive |
| 12 | Tag v1 release | all above | **OPEN** |

---

## Package Structure Per Workflow

Each v1 package ships with this structure. Workflows write into it:

```
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts        # public exports only
    types.ts        # all exported types and interfaces
    <name>.ts       # factory function and implementation
    <name>.test.ts  # unit tests per workflow
  README.md         # updated from placeholder in WF-7
```

Integration tests that span packages live in `packages/core/src/` or `packages/examples/src/` as the workflow scopes dictate.

---

## Reuse-First Rule

Before authoring a new package implementation workflow, agents should inspect `relay` and related AgentWorkforce repos for reusable packages, contracts, or runtime capabilities.

Specific instruction for memory:
- use the existing `@agent-relay/memory` package as the starting point
- treat `@relay-assistant/memory` as an assistant-facing integration/adaptation layer unless a clear gap requires new implementation work

This applies equally to proactive, policy, and any future packages. Investigation is not optional — it is the first step.

---

V1_WORKFLOW_BACKLOG_UPDATED


## Future Capability Note — Librarian / Cross-Agent Consolidation

A future **v5-v8 level** capability should add a librarian/night-crawler style system that consolidates memory across multiple agents. This is explicitly out of scope for the current v1 workflows, but current memory-related work should preserve provenance, confidence, and timestamp metadata so later consolidation remains possible.

---WEEKEND DELIVERY---
# Weekend Delivery Plan

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs; workspace install note added)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status reflected; workspace:* gap documented; traits/persona context added)
Target: 2026-04-13 (Sunday night)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example code in this document. All assembly examples below have been updated to match the reviewed specs and `docs/architecture/spec-reconciliation-rules.md`. If a code example conflicts with a spec, **trust the spec, not this document**.

## Implementation Status as of 2026-04-11

**WF-1 through WF-5 are COMPLETE.** The core, sessions, and surfaces packages are implemented and passing tests. The weekend delivery goal was to produce stable v1 type contracts for Sage, MSD, and NightCTO to write product adapter code against. That goal is met.

| Package | Tests | Status |
| --- | --- | --- |
| `@relay-assistant/core` | 44 pass | COMPLETE |
| `@relay-assistant/sessions` | 25 pass | COMPLETE |
| `@relay-assistant/surfaces` | 28 pass | COMPLETE |

**WF-6 is COMPLETE.** `packages/core/src/core-sessions-surfaces.test.ts` (describe block labeled WF-6) covers multi-surface session attachment, fanout, targeted send, and detach behavior.

**WF-7 is OPEN.** The end-to-end assembly test in `packages/examples/src/` does not yet exist. Package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive — not placeholders. The v1 release tag is gated on the assembly test being written.

**Remaining open items:**
- `@relay-assistant/routing` has a blocking DoD failure (12 tests, 40+ required). Do not wire routing into product code until this is resolved.
- No root `package.json` or monorepo workspace config exists. The `workspace:*` protocol referenced below is the target pattern, not current reality. Use `npm pack` tarballs or path-based installs until a root workspace is configured.

---

## Goal

Sage, MSD, and NightCTO teams can `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

> **npm install note:** For v1, "npm install" means **local monorepo consumption** via workspace references (`"@relay-assistant/core": "workspace:*"`) or `npm pack` tarballs — not the public npm registry. Public publishing is a post-v1 task tracked separately.
>
> **Workspace config gap:** No root `package.json` with workspace configuration currently exists. Each package is independently installable. Until a workspace root is configured, consume packages via `npm pack` tarballs or local path references. This is tracked in the audit plan as D-5.

The v1 type contracts that are now stable:

- `AssistantDefinition` (core)
- `AssistantRuntime` (core)
- `InboundMessage` / `OutboundEvent` (core)
- `CapabilityHandler` / `CapabilityContext` (core)
- `Session` / `SessionStore` (sessions)
- `AffinityResolver` / `resolveSession` (sessions)
- `SurfaceRegistry` / `SurfaceConnection` / `SurfaceAdapter` (surfaces)
- `SurfaceCapabilities` / `SurfaceFormatHook` / `FanoutResult` (surfaces)

---

## Traits and Persona Context

Products using this SDK should understand the distinction between workforce personas and assistant traits before writing product adapter code.

**Workforce personas** are runtime execution profiles (model, harness, system prompt, service tier). These are defined and owned in Workforce infrastructure. They are not imported from this SDK.

**Assistant traits** are identity and behavioral characteristics (voice, style, vocabulary, proactivity level). The `@relay-assistant/traits` package is planned for v1.2. In v1, products define traits as local data objects and inject them manually into persona prompts and format hooks.

See [traits-and-persona-layer.md](../architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Timeline

### Saturday Morning (2026-04-12, first half)

**Status: COMPLETE (implementation already done)**

All three specs are already `IMPLEMENTATION_READY`. WF-1, WF-2, WF-3 implementations are done and passing.

| Task | Deliverable | Status |
| --- | --- | --- |
| Read and confirm core spec | Mental model of `AssistantDefinition`, `AssistantRuntime`, adapters | DONE |
| Read and confirm sessions spec | Mental model of `Session`, `SessionStore`, `InMemorySessionStoreAdapter` | DONE |
| Read and confirm surfaces spec | Mental model of `SurfaceRegistry`, `SurfaceConnection`, fanout vs targeted send | DONE |
| Scaffold `packages/core` | `package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts` | DONE |
| Scaffold `packages/sessions` | same | DONE |
| Scaffold `packages/surfaces` | same | DONE |

---

### Saturday Afternoon (2026-04-12, second half)

**Status: COMPLETE**

| Workflow | Package | Key output | Status |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | `createAssistant`, `AssistantDefinition` validation, `AssistantRuntime`, `runtime.start()` / `runtime.stop()`, `runtime.status()` | COMPLETE — 44 tests |
| WF-2: Handle inbound message via dispatch | core | Capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()` | COMPLETE |
| WF-3: Create and manage sessions | sessions | `createSessionStore`, `InMemorySessionStoreAdapter`, full lifecycle (`touch`, `expire`, `sweepStale`), `attachSurface`, `detachSurface`, `resolveSession` | COMPLETE — 25 tests |

---

### Saturday Evening / Sunday Morning (2026-04-12 evening – 2026-04-13 morning)

**Status: COMPLETE**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-4: Wire session store into runtime | core + sessions | `runtime.register('sessions', store)`, `runtime.get<SessionStore>('sessions')`, `resolveSession` in handler | COMPLETE |
| WF-5: Register surface registry and route messages | core + surfaces | `createSurfaceRegistry`, `SurfaceConnection`, adapter wiring as core relay adapters, inbound normalization, outbound targeted send, `formatHook` | COMPLETE — 28 tests |

---

### Sunday Afternoon (2026-04-13 afternoon)

**Status: UNCERTAIN — verify before marking complete**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | Cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout rule validated | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` |
| WF-7: End-to-end assembly | core + sessions + surfaces | Full inbound→session→handler→emit→format→adapter cycle, validated assembly, examples package | **OPEN** — `packages/examples/src/` not yet created |

---

### Sunday Night (2026-04-13)

**Status: OPEN — consumer readiness verification needed**

Each product team runs the consumer readiness checklist against the released packages:

- [ ] `npm install @relay-assistant/core @relay-assistant/sessions @relay-assistant/surfaces` (resolves via workspace protocol or local tarballs — not the public npm registry for v1)
- [ ] Define an assistant with `createAssistant(definition, adapters)` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Register surfaces via `createSurfaceRegistry()` and wire it as the core relay adapter pair
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface via targeted send or fanout
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

Tag v1 release once all checks pass.

---

## Product-Specific Adoption Paths

### Sage Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. Draft a memory adapter interface stub so v1.1 memory integration can start Monday.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the Sage assistant identity using `createAssistant()`. Wire `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`. Register a Slack `SurfaceConnection` in a `SurfaceRegistry`. |
| Immediate after v1 | Begin adapter stub for `@relay-assistant/memory` (v1.1). Sage's existing memory patterns are the primary signal for the memory spec. |
| v1.1 gates | Full memory persistence across Sage sessions. Proactive follow-up engine. |
| v1.2 gates | `@relay-assistant/traits` — Sage is a primary extraction signal. Define local `sageTraits` object now so the v1.2 extraction has a concrete pattern to generalize from. |

**What stays in Sage for now:**
- Knowledge and workspace-specific prompt behavior
- Workforce persona definitions (model, harness, system prompt, tier) — these are workforce-owned, not SDK concerns
- Product-specific follow-up heuristics
- Slack-specific UI conventions and block kit templates
- Trait values (voice, style, vocabulary) — define as a local data object; `@relay-assistant/traits` ships at v1.2
- Memory retrieval logic (until v1.1 `@relay-assistant/memory` ships)

**Sage v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@relay-assistant/surfaces";

// 1. Define the Sage assistant
const definition: AssistantDefinition = {
  id: "sage",
  name: "Sage",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);

      // Sage domain handler — product-owned logic
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // Sage-specific response
      });
    },
  },
};

// 2. Wire sessions
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// 3. Wire surfaces
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "sage-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: stubSlackAdapter, // provided by relay foundation or product code
  formatHook: (event, caps) => ({ blocks: [{ type: "section", text: event.text }] }),
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// 4. Create runtime and register subsystems
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### MSD Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. MSD's cross-surface session design maps directly onto the v1 session model. Focus on the Slack + web multi-surface path.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the MSD assistant identity. Wire session store. Register Slack and web surface connections in the surface registry. |
| After v1 | Stub `@relay-assistant/policy` interface for approval-mode scaffolding (policy ships in v2 but MSD can define the interface contract early as a passthrough). |
| v1.2 gates | Coordination for review orchestration. Policy for external action governance. |

**What stays in MSD for now:**
- Code review operations and PR workflows
- Review-specific orchestration logic
- PR-specific tools and heuristics
- Workforce persona definitions — owned by Workforce, not imported from SDK
- Coordinator delegation (until v1.2 `@relay-assistant/coordination` ships for product use)

**MSD v1 minimum viable assembly:**

```ts
import { createAssistant } from "@relay-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@relay-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@relay-assistant/sessions";
import type { SessionStore } from "@relay-assistant/sessions";
import { createSurfaceRegistry } from "@relay-assistant/surfaces";
import type { SurfaceConnection } from "@relay-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "msd-review-assistant",
  name: "MSD",
  capabilities: {
    review: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // MSD review handler — product-owned logic

      // Targeted send: reply to originating surface
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // MSD-specific response
      });

      // Session fanout: notify ALL attached surfaces (surfaceId absent, sessionId present)
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "PR review complete — notifying all attached surfaces",
      // });
    },
  },
};

const sessionStore = createSessionStore({ adapter: new InMemorySessionStoreAdapter() });

const slackConnection: SurfaceConnection = {
  id: "msd-slack",
  type: "slack",
  state: "registered",
  capabilities: { markdown: false, richBlocks: true, attachments: true, streaming: false, maxResponseLength: 3000 },
  adapter: stubSlackAdapter,
};

const webConnection: SurfaceConnection = {
  id: "msd-web",
  type: "web",
  state: "registered",
  capabilities: { markdown: true, richBlocks: false, attachments: false, streaming: true, maxResponseLength: 0 },
  adapter: stubWebAdapter,
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);
surfaceRegistry.register(webConnection);

const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### NightCTO Adoption Path

---MEMORY README PLACEHOLDER---
# `@relay-assistant/memory`

Status: placeholder package README, no implementation yet.

## Purpose

This package is intended to define reusable assistant memory contracts.

Consumers should expect this package to own:

- memory scopes such as user, session, workspace, org, and object
- retrieval and persistence contracts
- promotion and compaction hooks
- adapter boundaries for future memory backends

## Expected Consumer Role

A product should import this package when assistant continuity depends on durable or structured memory.

Illustrative usage target:

```ts
import { createMemoryStore } from "@relay-assistant/memory";
```

## What Stays Outside

- product-specific tags and memory heuristics
- prompt assembly logic unique to one product
- private hosted memory implementations

---RELAY MEMORY PACKAGE.JSON---
{
  "name": "@agent-relay/memory",
  "version": "4.0.10",
  "description": "Semantic memory storage and retrieval system for agent-relay with multiple backend support",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agent-relay/hooks": "4.0.10"
  },
  "devDependencies": {
    "@types/node": "^22.19.3",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/AgentWorkforce/relay.git",
    "directory": "packages/memory"
  }
}

---RELAY MEMORY INDEX---
/**
 * Agent Relay Memory System
 *
 * Provides semantic memory storage and retrieval with multiple backend support.
 * Memory adapters can be used standalone or integrated with the hooks system.
 *
 * @example
 * ```typescript
 * import { createMemoryAdapter } from 'agent-relay/memory';
 *
 * // Create an in-memory adapter for testing
 * const memory = await createMemoryAdapter({ type: 'inmemory' });
 *
 * // Or use supermemory.ai for production
 * const memory = await createMemoryAdapter({
 *   type: 'supermemory',
 *   apiKey: process.env.SUPERMEMORY_API_KEY,
 * });
 *
 * // Add a memory
 * await memory.add('User prefers TypeScript', { tags: ['preference'] });
 *
 * // Search for relevant memories
 * const results = await memory.search({ query: 'programming language' });
 * ```
 */

export * from './types.js';
export * from './adapters/index.js';
export { createMemoryAdapter, getMemoryConfigFromEnv } from './factory.js';
export { createMemoryService } from './service.js';
export { createMemoryHooks, getMemoryHooks } from './memory-hooks.js';
export * from './context-compaction.js';

---RELAY MEMORY ADAPTERS---
../relay/packages/memory/src/adapters/index.ts
../relay/packages/memory/src/adapters/inmemory.ts
../relay/packages/memory/src/adapters/supermemory.ts
../relay/packages/memory/src/context-compaction.test.ts
../relay/packages/memory/src/context-compaction.ts
../relay/packages/memory/src/factory.ts
../relay/packages/memory/src/index.ts
../relay/packages/memory/src/memory-hooks.ts
../relay/packages/memory/src/service.ts
../relay/packages/memory/src/types.ts

---RELAY MEMORY TYPES---
/**
 * Agent Relay Memory Types
 *
 * Core types for the memory adapter system. Memory adapters provide
 * semantic storage and retrieval of agent learnings and context.
 */

/**
 * A memory entry stored in the system
 */
export interface MemoryEntry {
  /** Unique identifier for the memory */
  id: string;
  /** The actual content of the memory */
  content: string;
  /** Timestamp when memory was created */
  createdAt: number;
  /** Timestamp when memory was last accessed */
  lastAccessedAt?: number;
  /** Optional metadata tags */
  tags?: string[];
  /** Source of the memory (e.g., 'agent', 'user', 'session') */
  source?: string;
  /** Agent that created the memory */
  agentId?: string;
  /** Project associated with this memory */
  projectId?: string;
  /** Session ID where memory was created */
  sessionId?: string;
  /** Relevance score (when returned from search) */
  score?: number;
  /** Additional structured metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query options for searching memories
 */
export interface MemorySearchQuery {
  /** Semantic search query text */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Minimum relevance score threshold (0-1) */
  minScore?: number;
  /** Filter by tags */
  tags?: string[];
  /** Filter by agent ID */
  agentId?: string;
  /** Filter by project ID */
  projectId?: string;
  /** Filter by memories created after this timestamp */
  since?: number;
  /** Filter by memories created before this timestamp */
  before?: number;
}

/**
 * Options for adding a memory
 */
export interface AddMemoryOptions {
  /** Optional tags for the memory */
  tags?: string[];
  /** Source of the memory */
  source?: string;
  /** Agent creating the memory */
  agentId?: string;
  /** Project context */
  projectId?: string;
  /** Session context */
  sessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a memory operation
 */
export interface MemoryResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** ID of the affected memory (if applicable) */
  id?: string;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Memory adapter interface
 *
 * All memory backends must implement this interface to be used
 * with the agent-relay memory system.
 */
export interface MemoryAdapter {
  /** Unique identifier for this adapter type */
  readonly type: string;

  /**
   * Initialize the adapter (connect to backend, etc.)
   */
  init(): Promise<void>;

  /**
   * Add a new memory to the system
   * @param content - The content to remember
   * @param options - Optional metadata and context
   * @returns Result with the new memory's ID
   */
  add(content: string, options?: AddMemoryOptions): Promise<MemoryResult>;

  /**
   * Search for relevant memories
   * @param query - Search parameters
   * @returns Array of matching memories, ordered by relevance
   */
  search(query: MemorySearchQuery): Promise<MemoryEntry[]>;

  /**
   * Get a specific memory by ID
   * @param id - The memory ID
   * @returns The memory entry or null if not found
   */
  get(id: string): Promise<MemoryEntry | null>;

  /**
   * Delete a memory
   * @param id - The memory ID to delete
   * @returns Result indicating success/failure
   */
  delete(id: string): Promise<MemoryResult>;

  /**
   * Update an existing memory
   * @param id - The memory ID
   * @param content - New content
   * @param options - Optional updated metadata
   * @returns Result indicating success/failure
   */
  update?(id: string, content: string, options?: Partial<AddMemoryOptions>): Promise<MemoryResult>;

  /**
   * List recent memories
   * @param options - Filter options
   * @returns Array of recent memories
   */
  list?(options?: {
    limit?: number;
    agentId?: string;
    projectId?: string;
  }): Promise<MemoryEntry[]>;

  /**
   * Clear all memories matching criteria
   * @param options - Filter for what to clear
   */
  clear?(options?: {
    agentId?: string;
    projectId?: string;
    before?: number;
  }): Promise<MemoryResult>;

  /**
   * Get statistics about stored memories
   */
  stats?(): Promise<{
    totalCount: number;
    byAgent?: Record<string, number>;
    byProject?: Record<string, number>;
  }>;

  /**
   * Close the adapter and release resources
   */
  close?(): Promise<void>;
}

/**
 * Configuration for memory adapters
 */
export interface MemoryConfig {
  /** Adapter type: 'inmemory', 'supermemory', 'claude', etc. */
  type: string;
  /** API key for external services */
  apiKey?: string;
  /** API endpoint URL (for supermemory, etc.) */
  endpoint?: string;
  /** Default agent ID to use */
  defaultAgentId?: string;
  /** Default project ID to use */
  defaultProjectId?: string;
  /** Additional adapter-specific options */
  options?: Record<string, unknown>;
}

/**
 * Memory service interface for hooks
 *
 * This is a simplified interface exposed to hooks for memory operations.
 */
export interface MemoryService {
  /** Add a memory */
  add(content: string, options?: AddMemoryOptions): Promise<MemoryResult>;
  /** Search for memories */
  search(query: string | MemorySearchQuery): Promise<MemoryEntry[]>;
  /** Delete a memory */
  delete(id: string): Promise<MemoryResult>;
  /** List recent memories */
  list(limit?: number): Promise<MemoryEntry[]>;
  /** Check if memory service is available */
  isAvailable(): boolean;
}

---SAGE MEMORY SIGNALS---
../sage/README.md:11:1. **Researches** — searches the web and your GitHub repos for context
../sage/README.md:13:3. **Remembers** — persistent memory across conversations via Supermemory
../sage/README.md:26:                                    └── Supermemory (persistent memory)
../sage/README.md:35:Full planning pipeline. Planner agent (Opus 4.6) synthesizes context into structured plans and generates executable relay workflow definitions.
../sage/README.md:46:- Supermemory API key
../sage/README.md:65:| `SUPERMEMORY_API_KEY` | [supermemory.ai](https://supermemory.ai) | Persistent memory |
../sage/README.md:105:- Come back to the same thread later → Sage remembers the context
../sage/README.md:127:├── memory.ts              # Supermemory persistence layer
../sage/src/memory.ts:1:import { createMemoryAdapter } from '@agent-relay/memory';
../sage/src/memory.ts:2:import type { MemoryAdapter, MemoryEntry } from '@agent-relay/memory';
../sage/src/memory.ts:8:const SUPERMEMORY_ENDPOINT = process.env.SUPERMEMORY_ENDPOINT ?? 'https://api.supermemory.ai';
../sage/src/memory.ts:11:interface SupermemoryFilter {
../sage/src/memory.ts:16:interface SupermemoryListRequest {
../sage/src/memory.ts:21:    AND: SupermemoryFilter[];
../sage/src/memory.ts:25:interface SupermemoryDocument {
../sage/src/memory.ts:34:interface SupermemoryListResponse {
../sage/src/memory.ts:35:  documents?: SupermemoryDocument[];
../sage/src/memory.ts:38:export class SageMemory {
../sage/src/memory.ts:45:      type: 'supermemory',
../sage/src/memory.ts:57:      this.logError('Failed to initialize memory adapter', error);
../sage/src/memory.ts:91:      this.logError('Supermemory list failed; falling back to search', error);
../sage/src/memory.ts:97:      this.logError('Supermemory search fallback failed', error);
../sage/src/memory.ts:108:    const body: SupermemoryListRequest = {
../sage/src/memory.ts:133:        `Supermemory list request failed: ${error instanceof Error ? error.message : String(error)}`,
../sage/src/memory.ts:138:      throw new Error(`Supermemory list failed (${response.status}): ${await response.text()}`);
../sage/src/memory.ts:141:    const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/memory.ts:175:        `Supermemory search request failed: ${error instanceof Error ? error.message : String(error)}`,
../sage/src/memory.ts:180:      throw new Error(`Supermemory search failed (${response.status}): ${await response.text()}`);
../sage/src/memory.ts:183:    const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/memory.ts:187:  private toMemoryEntry(doc: SupermemoryDocument): MemoryEntry {
../sage/src/memory.ts:223:    return `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
../sage/src/memory.ts:227:    console.error(`[sage][memory] ${message}:`, error);
../sage/src/memory.ts:240:        this.logError('Failed to save memory', result.error ?? 'Failed to save memory');
../sage/src/memory.ts:243:      this.logError('Failed to save memory', error);
../sage/src/proactive/context-watcher.ts:4:import type { SageMemory } from "../memory.js";
../sage/src/proactive/context-watcher.ts:12:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/context-watcher.ts:29:interface SupermemoryFilter {
../sage/src/proactive/context-watcher.ts:34:interface SupermemoryDocument {
../sage/src/proactive/context-watcher.ts:41:interface SupermemoryListResponse {
../sage/src/proactive/context-watcher.ts:42:  documents?: SupermemoryDocument[];
../sage/src/proactive/context-watcher.ts:104:function getWorkspaceId(memory: SageMemory): string | undefined {
../sage/src/proactive/context-watcher.ts:105:  return readString((memory as unknown as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/context-watcher.ts:150:    console.warn("[proactive/context-watch] SUPERMEMORY_API_KEY is not set");
../sage/src/proactive/context-watcher.ts:154:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/context-watcher.ts:177:    console.error("[proactive/context-watch] Supermemory list request failed", error);
../sage/src/proactive/context-watcher.ts:182:    console.error("[proactive/context-watch] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/context-watcher.ts:186:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/context-watcher.ts:236:  memory: SageMemory,
../sage/src/proactive/context-watcher.ts:242:    console.warn("[proactive/context-watch] No notification channel configured");
../sage/src/proactive/context-watcher.ts:246:  const workspaceId = getWorkspaceId(memory);
../sage/src/proactive/context-watcher.ts:248:    console.warn("[proactive/context-watch] Could not determine workspace ID");
../sage/src/proactive/context-watcher.ts:254:    console.log("[proactive/context-watch] No research topics found");
../sage/src/proactive/context-watcher.ts:293:          console.warn(`[proactive/context-watch] Failed to post topic update for "${topic.topic}": ${result.error}`);
../sage/src/proactive/context-watcher.ts:298:        await memory.saveWorkspaceContext(
../sage/src/proactive/context-watcher.ts:306:        await memory.saveWorkspaceContext(
../sage/src/proactive/context-watcher.ts:312:      console.error(`[proactive/context-watch] Failed to inspect topic "${topic.topic}"`, error);
../sage/src/proactive/context-watcher.ts:316:  console.log(`[proactive/context-watch] Sent ${notifications} context notification(s)`);
../sage/src/proactive/follow-up-checker.ts:5:import type { SageMemory } from "../memory.js";
../sage/src/proactive/follow-up-checker.ts:16:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/follow-up-checker.ts:33:- If the destination is a notify channel instead of the original thread, include enough context so the message stands alone.
../sage/src/proactive/follow-up-checker.ts:37:interface SupermemoryFilter {
../sage/src/proactive/follow-up-checker.ts:42:interface SupermemoryDocument {
../sage/src/proactive/follow-up-checker.ts:50:interface SupermemoryListResponse {
../sage/src/proactive/follow-up-checker.ts:51:  documents?: SupermemoryDocument[];
../sage/src/proactive/follow-up-checker.ts:148:function toMemoryDoc(document: SupermemoryDocument): MemoryDoc {
../sage/src/proactive/follow-up-checker.ts:160:function getWorkspaceId(memory: SageMemory): string | undefined {
../sage/src/proactive/follow-up-checker.ts:161:  return readString((memory as unknown as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/follow-up-checker.ts:307:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/follow-up-checker.ts:330:    console.error("[proactive/follow-ups] Supermemory list request failed", error);
../sage/src/proactive/follow-up-checker.ts:335:    console.error("[proactive/follow-ups] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/follow-up-checker.ts:339:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/follow-up-checker.ts:446:export async function persistItem(memory: SageMemory, item: FollowUpItem): Promise<void> {
../sage/src/proactive/follow-up-checker.ts:447:  await memory.saveWorkspaceContext(JSON.stringify(item), [FOLLOW_UP_ITEM_TAG]);
../sage/src/proactive/follow-up-checker.ts:529:function persistLegacyMarker(memory: SageMemory, threadId: string, questionSummary: string): Promise<void> {
../sage/src/proactive/follow-up-checker.ts:530:  return memory.saveWorkspaceContext(
../sage/src/proactive/follow-up-checker.ts:546:  memory: SageMemory,
../sage/src/proactive/follow-up-checker.ts:552:  const workspaceId = getWorkspaceId(memory);
../sage/src/proactive/follow-up-checker.ts:578:      memory,
../sage/src/proactive/follow-up-checker.ts:605:        await persistItem(memory, evaluated.next);
../sage/src/proactive/follow-up-checker.ts:612:        await persistItem(memory, evaluated.next);
../sage/src/proactive/follow-up-checker.ts:645:        await persistItem(memory, persistedItem);
../sage/src/proactive/follow-up-checker.ts:646:        await persistLegacyMarker(memory, item.threadTs, evaluated.questionSummary ?? persistedItem.question);
../sage/src/proactive/follow-up-checker.ts:686:        await persistItem(memory, persistedItem);
../sage/src/proactive/follow-up-checker.ts:693:        await persistItem(memory, evaluated.next);
../sage/src/proactive/types.ts:1:import type { SageMemory } from "../memory.js";
../sage/src/proactive/types.ts:51:  memory: SageMemory;
../sage/src/proactive/engine.ts:6:import { SageMemory } from "../memory.js";
../sage/src/proactive/engine.ts:8:import { watchContext } from "./context-watcher.js";
../sage/src/proactive/engine.ts:19:  getMemory: (workspaceId: string) => SageMemory;
../sage/src/proactive/engine.ts:167:  routes.post("/context-watch", async (c) => {
../sage/src/proactive/stale-thread-detector.ts:4:import type { SageMemory } from "../memory.js";
../sage/src/proactive/stale-thread-detector.ts:15:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/stale-thread-detector.ts:42:interface SupermemoryFilter {
../sage/src/proactive/stale-thread-detector.ts:47:interface SupermemoryDocument {
../sage/src/proactive/stale-thread-detector.ts:52:interface SupermemoryListResponse {
../sage/src/proactive/stale-thread-detector.ts:53:  documents?: SupermemoryDocument[];
../sage/src/proactive/stale-thread-detector.ts:153:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/stale-thread-detector.ts:176:    console.error("[proactive/stale-threads] Supermemory list request failed", error);
../sage/src/proactive/stale-thread-detector.ts:181:    console.error("[proactive/stale-threads] Supermemory list failed", response.status, await response.text());
../sage/src/proactive/stale-thread-detector.ts:185:  const payload = (await response.json()) as SupermemoryListResponse;
../sage/src/proactive/stale-thread-detector.ts:257:  memory: SageMemory,
../sage/src/proactive/stale-thread-detector.ts:336:      await memory.saveWorkspaceContext(
../sage/src/proactive/scheduler.ts:219:    name: "sage-context-watch",
../sage/src/proactive/scheduler.ts:221:    path: "/api/proactive/context-watch",
../sage/src/proactive/evidence-sources/pr-merge-source.ts:9:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/evidence-sources/pr-merge-source.ts:34:interface SupermemoryFilter {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:39:interface SupermemoryDocument {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:46:interface SupermemorySearchResult {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:48:  document?: SupermemoryDocument;
../sage/src/proactive/evidence-sources/pr-merge-source.ts:51:interface SupermemorySearchResponse {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:52:  documents?: SupermemoryDocument[];
../sage/src/proactive/evidence-sources/pr-merge-source.ts:53:  results?: SupermemorySearchResult[];
../sage/src/proactive/evidence-sources/pr-merge-source.ts:72:function getWorkspaceId(memory: unknown): string | undefined {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:73:  return readString((memory as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/evidence-sources/pr-merge-source.ts:76:function normalizeSearchResults(payload: SupermemorySearchResponse): SearchDoc[] {
../sage/src/proactive/evidence-sources/pr-merge-source.ts:153:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/evidence-sources/pr-merge-source.ts:184:  const payload = (await response.json()) as SupermemorySearchResponse;
../sage/src/proactive/evidence-sources/pr-merge-source.ts:199:      const workspaceId = getWorkspaceId(ctx.memory);
../sage/src/proactive/pr-matcher.ts:6:import type { SageMemory } from "../memory.js";
../sage/src/proactive/pr-matcher.ts:7:import { PlanOutcomeStore } from "../memory/plan-outcomes.js";
../sage/src/proactive/pr-matcher.ts:21:const SUPERMEMORY_ENDPOINT = env.SUPERMEMORY_ENDPOINT ?? "https://api.supermemory.ai";
../sage/src/proactive/pr-matcher.ts:45:interface SupermemoryFilter {
../sage/src/proactive/pr-matcher.ts:50:interface SupermemoryDocument {
../sage/src/proactive/pr-matcher.ts:59:interface SupermemorySearchResult {
../sage/src/proactive/pr-matcher.ts:60:  document?: SupermemoryDocument;
../sage/src/proactive/pr-matcher.ts:64:interface SupermemorySearchResponse {
../sage/src/proactive/pr-matcher.ts:65:  documents?: SupermemoryDocument[];
../sage/src/proactive/pr-matcher.ts:66:  results?: SupermemorySearchResult[];
../sage/src/proactive/pr-matcher.ts:101:function getWorkspaceId(memory: SageMemory): string | undefined {
../sage/src/proactive/pr-matcher.ts:102:  return readString((memory as unknown as { workspaceId?: unknown }).workspaceId);
../sage/src/proactive/pr-matcher.ts:147:function normalizeSearchResults(payload: SupermemorySearchResponse): SupermemoryDocument[] {
../sage/src/proactive/pr-matcher.ts:161:function toMemoryDoc(document: SupermemoryDocument): MemoryDoc {
../sage/src/proactive/pr-matcher.ts:304:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/pr-matcher.ts:326:    console.error("[proactive/pr-matcher] Supermemory search request failed", error);
../sage/src/proactive/pr-matcher.ts:331:    console.error("[proactive/pr-matcher] Supermemory search failed", response.status, await response.text());
../sage/src/proactive/pr-matcher.ts:335:  const payload = (await response.json()) as SupermemorySearchResponse;
../sage/src/proactive/pr-matcher.ts:349:  const filters: SupermemoryFilter[] = [
../sage/src/proactive/pr-matcher.ts:379:  const payload = (await response.json()) as { documents?: SupermemoryDocument[] };
../sage/src/proactive/pr-matcher.ts:393:  memory: SageMemory,
../sage/src/proactive/pr-matcher.ts:456:  await new PlanOutcomeStore(memory).record({
../sage/src/proactive/pr-matcher.ts:472:  memory: SageMemory,
../sage/src/proactive/pr-matcher.ts:483:  const workspaceId = getWorkspaceId(memory);
../sage/src/proactive/pr-matcher.ts:496:    console.log(`[proactive/pr-matcher] No related memory found for PR #${prData.number}`);
../sage/src/proactive/pr-matcher.ts:544:    await memory.saveWorkspaceContext(
../sage/src/proactive/pr-matcher.ts:553:        memory,
../sage/src/bridging/topic-detector.ts:1:import { createMemoryAdapter } from "@agent-relay/memory";
../sage/src/bridging/topic-detector.ts:2:import type { MemoryAdapter, MemoryEntry } from "@agent-relay/memory";
../sage/src/bridging/topic-detector.ts:334:    await this.searchSupermemory(threadsToSearch, batchDetails);
../sage/src/bridging/topic-detector.ts:380:      type: "supermemory",
../sage/src/bridging/topic-detector.ts:481:    source: "cache" | "supermemory",
../sage/src/bridging/topic-detector.ts:507:      existing.source === "supermemory" || nextValue.source === "supermemory"
../sage/src/bridging/topic-detector.ts:508:        ? "supermemory"
../sage/src/bridging/topic-detector.ts:697:  private async searchSupermemory(
../sage/src/bridging/topic-detector.ts:739:        this.recordRelated(threadId, relatedThreadId, similarity, "supermemory");
../sage/src/bridging/topic-detector.ts:753:          related.source === "supermemory" ||
../sage/src/trajectories.ts:180:  private logError(context: string, error: unknown): void {
../sage/src/trajectories.ts:181:    console.error(`[trajectories] ${context} failed: ${getErrorMessage(error)}`);
../sage/src/app.ts:5:import { GitHubContextProvider } from "./integrations/github-context.js";
../sage/src/app.ts:9:import { SageMemory } from "./memory.js";
../sage/src/app.ts:10:import { OrgMemory } from "./memory/org-memory.js";
../sage/src/app.ts:18:import { watchContext } from "./proactive/context-watcher.js";
../sage/src/app.ts:71:const memories = new Map<string, SageMemory>();
../sage/src/app.ts:72:const orgMemories = new Map<string, OrgMemory>();
../sage/src/app.ts:187:function getMemory(workspaceId: string): SageMemory {
../sage/src/app.ts:188:  let memory = memories.get(workspaceId);
../sage/src/app.ts:189:  if (!memory) {
../sage/src/app.ts:190:    memory = new SageMemory(workspaceId);
../sage/src/app.ts:191:    memories.set(workspaceId, memory);
../sage/src/app.ts:193:  return memory;
../sage/src/app.ts:196:function getOrgMemory(workspaceId: string): OrgMemory {
../sage/src/app.ts:197:  let memory = orgMemories.get(workspaceId);
../sage/src/app.ts:198:  if (!memory) {
../sage/src/app.ts:199:    memory = new OrgMemory(workspaceId);
../sage/src/app.ts:200:    orgMemories.set(workspaceId, memory);
../sage/src/app.ts:202:  return memory;
../sage/src/app.ts:398:          console.warn(`[sage] Failed to parse active thread context for "${name}"`, error);
../sage/src/app.ts:484:  const memory = getMemory(workspaceId);
../sage/src/app.ts:485:  const orgMemory = getOrgMemory(workspaceId);
../sage/src/app.ts:511:      memory.loadContext(threadId),
../sage/src/app.ts:593:      await memory.saveContext(threadId, summary);
../sage/src/app.ts:595:      console.error("Failed to save Sage memory", error);
../sage/src/app.ts:813:  app.post("/api/proactive/context-watch", async (c) => {
../sage/src/test-e2e.ts:4:import { SageMemory } from "./memory.js";
../sage/src/test-e2e.ts:37:  memory: SageMemory,
../sage/src/test-e2e.ts:44:    lastValue = await memory.loadContext(threadId);
../sage/src/test-e2e.ts:61:  const summary = `Sage e2e memory check ${runId}`;
../sage/src/test-e2e.ts:90:      name: "SageMemory save/load round-trip",
../sage/src/test-e2e.ts:92:        const memory = new SageMemory(workspaceId);
../sage/src/test-e2e.ts:94:          await memory.saveContext(threadId, summary, ["e2e"]);
../sage/src/test-e2e.ts:95:          const loaded = await expectMemoryContains(memory, threadId, summary);
../sage/src/test-e2e.ts:97:            throw new Error("Loaded context did not include saved summary");
../sage/src/test-e2e.ts:100:          await memory.close();
../sage/src/bridging/types.ts:21:  source: "cache" | "supermemory";
../sage/src/prompt/index.ts:11:  buildOrgMemoryLayer,
../sage/src/prompt/index.ts:59:  // Layer 5: Org memory (priority 70)
../sage/src/prompt/index.ts:60:  const orgMemory = buildOrgMemoryLayer(options.orgContext);
../sage/src/prompt/index.ts:62:    builder.addLayer("org-memory", orgMemory.content, orgMemory.budget);
../sage/src/prompt/index.ts:73:  // Layer 7: Thread context (priority 60)
../sage/src/prompt/index.ts:76:    builder.addLayer("thread-context", threadContext.content, threadContext.budget);
../sage/src/swarm/router.ts:55:Your job is to inspect the user request plus the system prompt context and return a JSON tool plan.
../sage/src/swarm/router.ts:84:- If repo context is explicit, pass precise repo arguments.
../sage/src/swarm/router.ts:89:  return `System prompt context:
../sage/src/bridging/bridge-manager.ts:1:import { createMemoryAdapter } from "@agent-relay/memory";
../sage/src/bridging/bridge-manager.ts:2:import type { MemoryAdapter, MemoryEntry } from "@agent-relay/memory";
../sage/src/bridging/bridge-manager.ts:53:    await this.syncFromSupermemory(workspaceId);
../sage/src/bridging/bridge-manager.ts:121:      type: "supermemory",
../sage/src/bridging/bridge-manager.ts:132:  private async syncFromSupermemory(workspaceId: string): Promise<void> {
../sage/src/test/follow-up-evidence.test.ts:67:  process.env.SUPERMEMORY_API_KEY = originalApiKey ?? "test-supermemory-key";
../sage/src/test/follow-up-evidence.test.ts:94:  const memory = {
../sage/src/test/follow-up-evidence.test.ts:157:    memory,
../sage/src/test/follow-up-evidence.test.ts:186:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:220:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:252:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:265:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:329:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:364:        harness.memory as never,
../sage/src/test/follow-up-evidence.test.ts:401:        harness.memory as never,
../sage/src/prompt/layers/index.ts:5:export { buildOrgMemoryLayer } from "./org-memory.js";
../sage/src/prompt/layers/index.ts:6:export { buildThreadContextLayer } from "./thread-context.js";
../sage/src/swarm/github-tool.ts:32:  context: ToolExecutionContext,
../sage/src/swarm/github-tool.ts:309:function shouldUseGitHubFallback(context: ToolExecutionContext): boolean {
../sage/src/swarm/github-tool.ts:310:  return env.SAGE_GITHUB_VFS_ONLY !== 'true' && context.github !== null;
../sage/src/swarm/github-tool.ts:325:function ensureGitHubAvailable(context: ToolExecutionContext): string | null {
../sage/src/swarm/github-tool.ts:326:  if (env.SAGE_GITHUB_VFS_ONLY === 'true' && !context.reader.isEnabled()) {
../sage/src/swarm/github-tool.ts:330:  if (!context.reader.isEnabled() && context.github === null) {
../sage/src/swarm/github-tool.ts:376:  context: ToolExecutionContext,
../sage/src/swarm/github-tool.ts:390:  if (options.fallback && shouldUseGitHubFallback(context)) {
../sage/src/swarm/github-tool.ts:394:  const unavailable = ensureGitHubAvailable(context);
../sage/src/swarm/github-tool.ts:403:  async github_search_code(args, context) {
../sage/src/swarm/github-tool.ts:406:    const github = context.github;
../sage/src/swarm/github-tool.ts:407:    return tryVfsThenNango(context, {
../sage/src/swarm/github-tool.ts:412:      vfs: () => context.reader.searchGitHubCode(query, repo),
../sage/src/swarm/github-tool.ts:416:  async github_search_issues(args, context) {
../sage/src/swarm/github-tool.ts:419:    const github = context.github;
../sage/src/swarm/github-tool.ts:420:    return tryVfsThenNango(context, {
../sage/src/swarm/github-tool.ts:425:      vfs: () => context.reader.searchGitHubIssues(query, repo),
../sage/src/swarm/github-tool.ts:429:  async github_read_file(args, context) {
../sage/src/swarm/github-tool.ts:434:    const github = context.github;
../sage/src/swarm/github-tool.ts:435:    return tryVfsThenNango(context, {
../sage/src/swarm/github-tool.ts:440:      vfs: () => context.reader.readGitHubFile(owner, repo, filePath, ref),
