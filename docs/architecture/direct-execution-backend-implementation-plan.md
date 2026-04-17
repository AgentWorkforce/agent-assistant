# Direct Execution Backend Implementation Plan

Date: 2026-04-17
Status: Proposed

## Goal

Turn the execution/backend direction into two concrete implementation tracks:

1. **direct OpenRouter/API execution backend**
2. **separate harness BYOH backend track**

The plan assumes:
- no `pi-ai` adapter adoption for the immediate path
- Agent Assistant continues to own runtime semantics above the backend boundary

## Track A — Direct OpenRouter/API backend

### Scope

Implement a hosted API backend that executes bounded assistant turns against OpenRouter and normalizes the result into Agent Assistant execution semantics.

### Recommended landing place

Keep the backend behind the existing `ExecutionAdapter` seam in the harness adapter layer.

Suggested implementation shape:
- new adapter source in `packages/harness/src/adapter/`
- backend id such as `openrouter-api`

### Phase A1 — Boundary tightening

Define the exact mapping from `ExecutionRequest` to hosted API request shape.

Must cover:
- system/developer prompt handling
- context block flattening rules
- tool descriptor mapping
- attachment policy (likely degraded or unsupported in v1 unless already solved)
- response text normalization
- capability negotiation defaults

### Phase A2 — Minimal non-tool turn

Implement the first bounded OpenRouter execution path for:
- no tools
- no continuation
- plain bounded response

Validation:
- `completed` result path
- hosted API error path
- unsupported/degraded negotiation path

### Phase A3 — Tool-capable turn

Extend the backend to support tool-available turns where the backend can emit structured tool requests or degrade honestly if the exact hosted path cannot.

Validation:
- tool-bearing execution request
- normalized structured output where possible
- truthful degradation where not possible

### Phase A4 — Trace + metadata

Add execution trace normalization for hosted API requests.

Trace does not need to be deep in v1, but it should include:
- start/completion timestamps
- degraded vs non-degraded flag
- step/tool counts when available
- failure metadata on backend/API failure

## Track B — Harness BYOH backend

### Scope

Keep local/external harness execution as a distinct backend family.

Current anchor:
- Claude Code execution adapter

### Phase B1 — Preserve separation

Do not merge harness BYOH concerns into the hosted API backend.

Explicit rule:
- API backend ≠ CLI harness backend

### Phase B2 — Capability truthfulness

Ensure the harness backend continues to advertise limits honestly, especially for:
- continuation support
- approval interrupts
- attachments
- trace depth

### Phase B3 — Product adoption guidance

Document for consuming products:
- when to use hosted API backend
- when to use harness BYOH backend
- that both are execution backends behind the same bounded contract

## Shared constraints

### Agent Assistant still owns
- assistant identity/traits
- turn-context assembly
- policy decisions
- continuation semantics
- Relay-native collaboration

### Backends own only
- request translation
- backend invocation
- output normalization
- capability/degradation reporting

## Suggested implementation sequence

1. Write/refresh one backend-boundary note tying this plan to `ExecutionAdapter`
2. Implement direct OpenRouter no-tool proof backend
3. Add focused tests for success, failure, and negotiation
4. Extend to tool-capable path if the hosted path supports it cleanly
5. Update consumer docs describing API backend vs harness BYOH backend

## Validation bar

The direct OpenRouter backend is ready for product proving only when it has:
- deterministic adapter tests
- at least one truthful degradation case
- at least one successful bounded completion case
- clear docs that it is an API backend, not a replacement for harness BYOH

## Non-goals

Do not:
- widen into multi-provider breadth as the first slice
- introduce a new generic provider abstraction layer just to avoid direct OpenRouter work
- blur hosted API execution with CLI harness execution
- relocate policy/continuation logic into the backend layer

## Expected result

After this implementation plan, Agent Assistant should have a clear execution story:
- **OpenRouter/API backend for hosted execution**
- **Claude Code / harness backend for BYOH local execution**
- **shared execution contract above both**
