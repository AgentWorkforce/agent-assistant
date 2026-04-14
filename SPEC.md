# SPEC: BYOH Harness Adapter & SDK Completion Plan

> **Governing rule:** Separate product identity from execution.
> Every design decision in this document follows from this principle.

---

## 1. V1 BYOH Harness Adapter Architecture

### 1.1 The Adapter Is a Seam, Not a Layer

The execution adapter translates between the product's canonical `ExecutionRequest` and a concrete backend's native format. It owns **only translation** — not policy, memory, sessions, continuation persistence, or coordination.

```
Product Runtime (identity, policy, coordination, continuation lifecycle)
       │
  TurnContextAssembler.assemble(input) → TurnContextAssembly
       │
  TurnContextAssembly.harnessProjection → ExecutionRequest
       │
  ExecutionAdapter.negotiate(request) → ExecutionNegotiation
       │  (if supported)
  ExecutionAdapter.execute(request) → ExecutionResult
       │
  Product Runtime acts on result (continuation, delivery, session update)
```

### 1.2 Core Contract

```typescript
interface ExecutionAdapter {
  readonly backendId: string;
  describeCapabilities(): ExecutionCapabilities;
  negotiate(request: ExecutionRequest): ExecutionNegotiation;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

**Adapter size target:** ~100–200 lines of translation code per backend. If an adapter grows beyond this, orchestration is leaking into it.

### 1.3 Capability Negotiation

Capabilities go beyond booleans. Each declares a spectrum:

| Capability | Values | Meaning |
|---|---|---|
| `toolUse` | `none` / `adapter-mediated` / `native-iterative` | Whether and how the backend handles tool calls |
| `continuationSupport` | `none` / `opaque-resume` / `structured` | Resume affordance fidelity |
| `approvalInterrupts` | `none` / `adapter-mediated` / `native` | In-band approval pause support |
| `traceDepth` | `minimal` / `standard` / `detailed` | Execution observability level |
| `attachments` | `boolean` | File/media support |
| `maxContextStrategy` | `unknown` / `small` / `medium` / `large` | Context window classification |

`negotiate()` returns `{ supported, degraded, reasons[], effectiveCapabilities }`. This is a **read-only check** — no side effects, no execution.

### 1.4 Truthful Degradation Rules

- Backend text asking for approval ≠ native approval interrupt support
- Transcript dump ≠ structured continuation support
- Provider logs ≠ detailed execution traces

When a required capability is absent, the adapter must return `supported: false` or `degraded: true` with machine-readable `reasons[]`. The product runtime decides how to handle degradation — not the adapter.

### 1.5 Versioning & Observability

All contract types (`ExecutionRequest`, `ExecutionResult`, `ExecutionCapabilities`) must carry:

- **Schema version** — enables non-breaking evolution across adapter implementations
- **Correlation/trace IDs** — `turnId`, `sessionId`, `assistantId` flow through every layer
- **Cancellation/timeout semantics** — adapters must respect `requirements.maxElapsedMs` and surface timeout as a structured error, not a hang

### 1.6 Tool Mediation (Not Registry)

The adapter receives tools in `ExecutionRequest.tools[]` — already selected by product/runtime policy. The adapter's job is to:

1. Translate tool schemas to the backend's native format
2. Mediate the tool-call loop if the backend doesn't support native iteration
3. Return tool results in canonical `ExecutionResult` format

Tool **choice** belongs upstream. Tool **execution** belongs to the harness/backend. The adapter **translates between the two**.

### 1.7 Continuation Boundary

The adapter may emit `continuation` payloads in `ExecutionResult`, but:

- Continuation **persistence** → `@agent-assistant/continuation`
- Continuation **resume triggers** → `ContinuationRuntime.resume()`
- Follow-up **delivery** → `ContinuationDeliveryAdapter`

The adapter is stateless with respect to continuation lifecycle.

---

## 2. SDK Completion: What Needs to Be Implemented

### 2.1 Critical Blockers (Must Fix Before Any Release)

| Item | Package | Issue | Resolution |
|---|---|---|---|
| **npm dist/ artifacts** | All published | Tarballs lack compiled output | Rebuild, repack, republish wave-1 packages |
| **Coordination test resolution** | `@agent-assistant/coordination` | vitest can't resolve connectivity imports | Fix `@agent-assistant/connectivity` package.json exports for vitest |
| **Memory external dep** | `@agent-assistant/memory` | Depends on private `@agent-relay/memory` | Publish relay foundation package or extract memory store interface |

### 2.2 New Package: `@agent-assistant/execution-adapter`

This is the primary new implementation required. It provides:

1. **Type definitions** — `ExecutionAdapter`, `ExecutionRequest`, `ExecutionResult`, `ExecutionCapabilities`, `ExecutionNegotiation` (already specced in `v1-execution-adapter-spec.md`)
2. **First-party adapter** — `BuiltInHarnessAdapter` that routes through existing `@agent-assistant/harness`
3. **Adapter test harness** — Conformance test suite any adapter must pass
4. **Factory** — `createExecutionAdapter(config)` with backend selection

```typescript
// Minimal public API
export { createExecutionAdapter, createBuiltInHarnessAdapter };
export type {
  ExecutionAdapter,
  ExecutionRequest,
  ExecutionResult,
  ExecutionCapabilities,
  ExecutionNegotiation,
  ExecutionNegotiationReason,
};
```

### 2.3 Gaps in Existing Packages

| Package | Gap | Action |
|---|---|---|
| `turn-context` | No `toExecutionRequest()` projection | Add projection method that maps `TurnContextAssembly.harnessProjection` → `ExecutionRequest` |
| `continuation` | No `fromExecutionResult()` bridge | Add factory that creates `CreateContinuationInput` from `ExecutionResult` |
| `sdk` facade | Doesn't re-export wave-2 packages | Add named sub-path exports: `@agent-assistant/sdk/harness`, `@agent-assistant/sdk/execution-adapter`, etc. |
| `routing` | No execution-adapter awareness | Add `routeToAdapter()` that selects adapter based on model/cost/latency recommendation |
| `coordination` | Tests blocked | Fix connectivity vitest resolution before declaring coordination stable |

### 2.4 Integration Test Suite

A new `integration-tests/execution-adapter` suite that proves the full flow:

1. Turn-context assembly → ExecutionRequest → built-in adapter → ExecutionResult
2. ExecutionResult → continuation creation → resume → re-execution
3. Negotiation with degraded capabilities
4. Negotiation with unsupported capabilities (blocking)
5. Tool-bearing execution through adapter
6. Timeout/cancellation handling

---

## 3. Integrating Existing Packages Into the BYOH Framework

### 3.1 Package Roles in the BYOH Flow

```
┌─────────────────────────────────────────────────────────┐
│  Product Runtime (canonical, not replaceable)            │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │  traits   │  │ sessions │  │  surfaces  │             │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘             │
│       │              │              │                    │
│  ┌────▼──────────────▼──────────────▼─────┐             │
│  │          turn-context assembler         │             │
│  └────────────────┬───────────────────────┘             │
│                   │                                      │
│  ┌────────────────▼───────────────────────┐             │
│  │    policy (pre-execution gate)          │             │
│  └────────────────┬───────────────────────┘             │
│                   │                                      │
│  ┌────────────────▼───────────────────────┐             │
│  │    routing (adapter/model selection)    │             │
│  └────────────────┬───────────────────────┘             │
│                   │                                      │
│  ═════════════════╪═══════════════════════ ADAPTER SEAM  │
│                   │                                      │
│  ┌────────────────▼───────────────────────┐             │
│  │    execution-adapter (translation)      │             │
│  │    ┌─────────────────────────────┐     │             │
│  │    │  Built-in harness adapter   │     │             │
│  │    │  Claude API adapter         │     │             │
│  │    │  Codex adapter              │     │             │
│  │    │  Custom BYOH adapter        │     │             │
│  │    └─────────────────────────────┘     │             │
│  └────────────────┬───────────────────────┘             │
│                   │                                      │
│  ═════════════════╪═══════════════════════ ADAPTER SEAM  │
│                   │                                      │
│  ┌────────────────▼───────────────────────┐             │
│  │    continuation (post-execution)        │             │
│  └────────────────┬───────────────────────┘             │
│                   │                                      │
│  ┌────────────────▼───────────────────────┐             │
│  │    proactive (follow-up decisions)      │             │
│  └────────────────────────────────────────┘             │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐          │
│  │  memory   │  │ connectivity │  │ coordin. │          │
│  └──────────┘  └──────────────┘  └──────────┘          │
│  (feed into turn-context as enrichment candidates)      │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Mapping: Existing Package → BYOH Role

| Package | BYOH Role | Changes Required |
|---|---|---|
| **core** | Shell — lifecycle, dispatch. Unchanged. | None |
| **traits** | Identity floor fed into turn-context. | None |
| **sessions** | Session identity. Stays above adapter. | None |
| **surfaces** | Inbound normalization, outbound delivery. Stays above adapter. | None |
| **turn-context** | Assembles `TurnContextAssembly` → projects to `ExecutionRequest`. | Add `toExecutionRequest()` projection |
| **harness** | Becomes the built-in backend behind `BuiltInHarnessAdapter`. | No changes to harness itself — adapter wraps it |
| **policy** | Pre-execution gate. Evaluates before adapter dispatch. | None |
| **routing** | Selects which adapter to use based on model/cost/latency. | Add adapter-aware routing |
| **continuation** | Post-execution lifecycle. Consumes `ExecutionResult`. | Add `fromExecutionResult()` bridge |
| **proactive** | Follow-up decisions after continuation. | None |
| **connectivity** | Inter-agent signaling. Feeds enrichment into turn-context. | Fix vitest exports |
| **coordination** | Multi-agent delegation. Feeds enrichment into turn-context. | Unblock tests |
| **memory** | Memory retrieval. Feeds candidates into turn-context. | Unblock `@agent-relay/memory` dep |

### 3.3 The Built-In Harness Adapter

The first adapter implementation wraps the existing `@agent-assistant/harness`:

```typescript
class BuiltInHarnessAdapter implements ExecutionAdapter {
  readonly backendId = 'built-in-harness';

  describeCapabilities(): ExecutionCapabilities {
    return {
      toolUse: 'native-iterative',
      structuredToolCalls: true,
      continuationSupport: 'structured',
      approvalInterrupts: 'native',
      traceDepth: 'detailed',
      attachments: false,
      maxContextStrategy: 'large',
    };
  }

  negotiate(request: ExecutionRequest): ExecutionNegotiation {
    // Check attachment requirements, validate tool schemas, etc.
    // Return supported/degraded/unsupported
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // 1. Translate ExecutionRequest → HarnessTurnInput
    // 2. Call harness.runTurn(input)
    // 3. Translate HarnessResult → ExecutionResult
  }
}
```

This adapter should be ~100–150 lines. It proves the seam is real before any external backend is attempted.

---

## 4. Implementation Phases

### Phase 0: Unblock (1–2 days)

**Priority: Critical. Nothing else ships until these are done.**

- [ ] Fix npm dist/ artifacts — rebuild and republish all wave-1 packages
- [ ] Fix `@agent-assistant/connectivity` package.json exports for vitest resolution
- [ ] Re-run coordination test suite and confirm all tests pass
- [ ] Decision: publish `@agent-relay/memory` or extract a standalone memory store interface

### Phase 1: Adapter Contract & Proof (3–5 days)

**Priority: High. Proves BYOH is real, not aspirational.**

- [ ] Create `@agent-assistant/execution-adapter` package with type definitions from `v1-execution-adapter-spec.md`
- [ ] Implement `BuiltInHarnessAdapter` wrapping `@agent-assistant/harness`
- [ ] Add schema version field to `ExecutionRequest`, `ExecutionResult`, `ExecutionCapabilities`
- [ ] Add correlation/trace ID passthrough
- [ ] Write proof-of-concept integration tests:
  - Completed turn (no tools)
  - Completed turn (with tools)
  - Needs-clarification → continuation emission
  - Awaiting-approval → continuation emission
  - Negotiation: degraded case (e.g., attachments required but unsupported)
  - Negotiation: blocking unsupported case
  - Timeout/cancellation handling
- [ ] Add `toExecutionRequest()` projection to `@agent-assistant/turn-context`
- [ ] Add `fromExecutionResult()` bridge to `@agent-assistant/continuation`

### Phase 2: Routing & End-to-End Integration (3–5 days)

**Priority: High. Connects the full pipeline.**

- [ ] Add adapter-aware routing to `@agent-assistant/routing` — `routeToAdapter()` that selects adapter + model based on cost/latency/capability
- [ ] Build full pipeline integration test: `turn-context → routing → negotiate → execute → continuation → delivery`
- [ ] Add adapter conformance test suite (reusable for any future adapter)
- [ ] Update SDK facade with sub-path exports for wave-2 packages
- [ ] Document the canonical orchestration flow with code examples

### Phase 3: Second Adapter — External Backend (5–7 days)

**Priority: Medium. Validates BYOH with a real external backend.**

- [ ] Implement `ClaudeAPIAdapter` or `CodexAdapter` (pick one as the proof)
- [ ] Map capability differences honestly (e.g., Codex: `approvalInterrupts: 'none'`, `continuationSupport: 'opaque-resume'`)
- [ ] Run conformance test suite against second adapter
- [ ] Validate degradation paths — ensure the pipeline handles `supported: false` and `degraded: true` correctly end-to-end
- [ ] Document adapter authoring guide for BYOH consumers

### Phase 4: Memory & Coordination Completion (3–5 days)

**Priority: Medium. Completes the enrichment pipeline.**

- [ ] Unblock memory package (publish relay dep or extract interface)
- [ ] Wire memory retrieval into turn-context as `TurnMemoryInput` candidates
- [ ] Wire coordination specialist memos into turn-context as `TurnEnrichmentInput` candidates
- [ ] Integration test: memory + coordination → turn-context → adapter → result

### Phase 5: Hardening & Release (2–3 days)

**Priority: Final gate.**

- [ ] Republish all packages with correct dist/ artifacts
- [ ] Update all package versions to 0.2.0 (adapter-aware release)
- [ ] Run full test suite (target: 500+ tests passing, 0 blocked suites)
- [ ] Update `docs/index.md` with BYOH architecture section
- [ ] Update examples with adapter-aware usage patterns
- [ ] Tag release

---

## 5. Patterns to Adopt From Reference Frameworks

### What to adopt — and why

| Pattern | Source | Adopt Because | How to Apply |
|---|---|---|---|
| **Standardized tool-call schema & result envelope** | OpenHarness | Prevents each adapter from inventing its own tool format | Already reflected in `ExecutionRequest.tools[]` and `HarnessToolCall`/`HarnessToolResult` types. Ensure all adapters conform. |
| **Plugin discovery & capability introspection** | OpenClaw | Adapters need to self-describe without executing | `describeCapabilities()` and `negotiate()` are direct applications. Extend with runtime capability refresh if backends change. |
| **Permission model: sandbox → ask → allow** | Claude Code | Tool execution needs graduated trust levels | Map to `policy` package's existing `allow/deny/approve/escalate` classification. Adapters declare `requiresApproval` per tool; policy decides. |
| **Iterative tool-use loops with deterministic stop** | Claude Code | The core execution pattern for agentic turns | Already implemented in `@agent-assistant/harness`. Expose through adapter for backends that support it natively. |
| **Streaming-first execution** | Open Agents (Vercel) | Users expect incremental output, not batch responses | Add optional `executeStreaming()` to `ExecutionAdapter` interface in Phase 3+. Not required for v1 — batch `execute()` is the baseline. |
| **Edge-compatible adapter pattern** | Open Agents (Vercel) | Adapters should be deployable anywhere, not just Node servers | Keep adapter implementations dependency-light. No Node-specific APIs in the contract types. |
| **Hierarchical task decomposition** | DeepAgents | Complex tasks need plan-then-execute patterns | Already reflected in `coordination` package's specialist/delegation model. Adapter doesn't own decomposition — product runtime does. |
| **Conversational state & persona layering** | pi | Personality should persist across turns and adapt to context | Already reflected in `traits` + `turn-context` shaping. Traits are the stable floor; shaping overlays modulate per-turn. |

### What to skip — and why

| Pattern | Source | Skip Because |
|---|---|---|
| Over-abstracted middleware chains | OpenHarness | Adapter is a seam, not a pipeline. Middleware belongs in product runtime if needed at all. |
| Tight model-provider coupling | OpenClaw | The entire point of BYOH is backend independence. |
| Consumer UX patterns | pi | This is an SDK, not a consumer product. UX belongs in the product layer. |
| Monolithic CLI coupling | Claude Code | Adapter must be importable as a library, not tied to a CLI runtime. |
| Heavy orchestration overhead | DeepAgents | Simple turns shouldn't pay the cost of hierarchical decomposition. Orchestration is product-owned. |
| Framework lock-in primitives | Open Agents (Vercel) | Adapters must work in any runtime, not just Vercel/Next.js. |

### Key principle for framework adoption

The framework comparison is secondary to the contract and ownership rules. Named inspirations inform design choices — they do not drive them. If a pattern from a reference framework conflicts with "separate product identity from execution," the pattern loses.

---

## Appendix A: Type Relationship Summary

```
TurnContextInput
  → TurnContextAssembler.assemble()
  → TurnContextAssembly
    → .harnessProjection + message + tools
    → ExecutionRequest

ExecutionRequest
  → ExecutionAdapter.negotiate()
  → ExecutionNegotiation { supported, degraded, reasons, effectiveCapabilities }

ExecutionRequest
  → ExecutionAdapter.execute()
  → ExecutionResult { status, output, continuation, trace, degradation }

ExecutionResult (if resumable)
  → ContinuationRuntime.create()
  → ContinuationRecord { status: 'pending', waitFor, bounds }

ContinuationResumeTrigger
  → ContinuationRuntime.resume()
  → new HarnessTurnInput → adapter.execute() → new ExecutionResult
```

## Appendix B: Adapter Conformance Checklist

Any `ExecutionAdapter` implementation must pass these assertions:

- [ ] `describeCapabilities()` returns valid `ExecutionCapabilities` with no `undefined` fields
- [ ] `negotiate()` returns `supported: false` when a `'required'` capability is absent
- [ ] `negotiate()` returns `degraded: true` with reasons when a `'preferred'` capability is absent
- [ ] `negotiate()` has no side effects (no network calls, no state mutation)
- [ ] `execute()` returns `status: 'completed'` with `output.text` for a simple message
- [ ] `execute()` returns `status: 'completed'` with tool trace for a tool-bearing request
- [ ] `execute()` returns `status: 'needs_clarification'` with `continuation` payload when model asks for clarification
- [ ] `execute()` returns `status: 'awaiting_approval'` with `approvalRequest` when approval is needed
- [ ] `execute()` returns `status: 'failed'` with structured `error` on backend failure — never silently swallows errors
- [ ] `execute()` returns `status: 'unsupported'` rather than faking success for unsupported operations
- [ ] `trace.summary` is populated with `startedAt`, `completedAt`, `stepCount`, `toolCallCount`
- [ ] `backendId` is stable and unique across adapter instances
- [ ] Adapter respects timeout from `requirements.maxElapsedMs` — returns `error.code: 'timeout'` if exceeded
- [ ] Adapter does not call policy, session, continuation, or memory APIs
- [ ] Adapter implementation is ≤200 lines of translation code (guideline, not hard limit)
