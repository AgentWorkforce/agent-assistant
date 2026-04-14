# v1 Execution Adapter Proof Contract

**Date:** 2026-04-14  
**Status:** ACTIVE / INTERNAL PROOF CONTRACT  
**Depends on:**
- `docs/specs/v1-execution-adapter-spec.md`
- `docs/architecture/v1-execution-adapter-proof-slice.md`
- `docs/specs/v1-harness-spec.md`
- `docs/specs/v1-turn-context-enrichment-spec.md`

---

## 1. Purpose

This contract defines the exact proof required to say the v1 execution-adapter seam is real **against the current first-party harness**.

It is intentionally narrower than the full execution-adapter architecture.
It does not authorize broad external backend work yet.

---

## 2. Proving subject

The proving subject is one internal adapter implementation:

- **Backend id:** `agent-assistant-harness`
- **Role:** map canonical `ExecutionRequest` into the existing `@agent-assistant/harness` runtime and normalize the resulting bounded turn outcome back into `ExecutionResult`

The proof is successful only if the adapter is exercised through the canonical adapter entrypoints:
- `describeCapabilities()`
- `negotiate(request)`
- `execute(request)`

---

## 3. Required architecture invariants

The proof implementation must preserve all of the following invariants.

### 3.1 Upstream ownership invariants

The adapter must not own:
- assistant identity composition
- turn-context assembly
- memory retrieval or ranking
- policy decisions
- session lifecycle
- continuation lifecycle
- Relay coordination or transport

### 3.2 Backend ownership invariant

The existing harness remains the execution owner for the bounded turn.
The adapter must delegate bounded turn execution to `HarnessRuntime.runTurn()` rather than reproducing harness loop semantics in a parallel layer.

### 3.3 Canonical contract invariant

The adapter entrypoint must accept canonical execution shapes and return canonical execution shapes.
The proof fails if the caller still has to speak raw harness types end-to-end.

---

## 4. Required proving path

The implementation must support this exact path:

```text
TurnContextAssembly
  -> build canonical ExecutionRequest
  -> agent-assistant-harness ExecutionAdapter
  -> HarnessRuntime.runTurn()
  -> normalized ExecutionResult
```

## 4.1 Required request source

The proof must use real `turn-context` output for:
- `instructions`
- `context`

The proof may construct `ExecutionRequest.message`, `tools`, `continuation`, and `metadata` in the test/integration layer.

## 4.2 Required translation coverage

The adapter must translate at least these fields:

| Canonical field | Backend target |
| --- | --- |
| `assistantId` | `HarnessTurnInput.assistantId` |
| `turnId` | `HarnessTurnInput.turnId` |
| `sessionId` | `HarnessTurnInput.sessionId` |
| `userId` | `HarnessTurnInput.userId` |
| `threadId` | `HarnessTurnInput.threadId` |
| `message` | `HarnessTurnInput.message` |
| `instructions` | `HarnessTurnInput.instructions` |
| `context` | `HarnessTurnInput.context` |
| `continuation` | `HarnessTurnInput.continuation` |
| selected tools | harness-visible tool availability/allowlist path |
| `metadata` | `HarnessTurnInput.metadata` |

---

## 5. Required execution capabilities for the proof

The first-party adapter must expose capability values that are truthful for the current proof scope.

## 5.1 Minimum capabilities that must be declared

The proof implementation must declare values for:
- `toolUse`
- `structuredToolCalls`
- `continuationSupport`
- `approvalInterrupts`
- `traceDepth`
- `attachments`

## 5.2 Capability truth rule

The proof must not overclaim capabilities simply because the first-party harness exists.
The adapter may only claim support for what it actually wires through the canonical request/result path in this proof.

Example:
- if attachments are merely carried through types but not meaningfully exercised, the capability should not be overstated
- if detailed trace normalization is not implemented, `traceDepth` must be lowered accordingly

---

## 6. Required negotiations

The proof must include negotiation behavior for all requests under test.

### 6.1 Happy-path negotiation requirement

For supported proof scenarios, `negotiate(request)` must return:
- `supported: true`
- accurate `degraded` flag
- effective capabilities
- empty or meaningful reasons as appropriate

### 6.2 Negative or degraded negotiation requirement

At least one scenario must prove that `negotiate(request)` can return either:
- `supported: false`, or
- `supported: true` with `degraded: true`

along with at least one structured negotiation reason.

### 6.3 Recommended minimal negative case

The simplest acceptable negative case is a request that marks a capability as `required` when the proof implementation intentionally does not provide that capability through the adapter path.

Recommended candidate:
- `attachments: 'required'` when the first proof does not include meaningful attachment handling end-to-end

Alternative acceptable candidate:
- `traceDepth: 'detailed'` when the adapter only normalizes standard trace facts

---

## 7. Required execution outcomes to prove

The first proof must cover these outcome classes through `execute(request)`.

### 7.1 `completed`

Required in two forms:
1. completed without tools
2. completed with at least one tool-bearing turn

### 7.2 `needs_clarification`

Required with normalized continuation payload present.

### 7.3 `awaiting_approval`

Required with normalized approval/continuation-shaped information present.

### 7.4 `failed`

Required for at least one adapter- or backend-normalized failure case.

The proof may also include `deferred`, but that is not required for the first slice if it broadens the work materially.

---

## 8. Required normalization behavior

The adapter must normalize harness results into canonical `ExecutionResult` values.

## 8.1 Required normalized fields

For the covered scenarios, the proof must show canonical output carrying at least:
- `backendId`
- `outcome`
- `stopReason`
- `assistantMessage` when present
- `continuation` when present
- `degraded`
- inspectable trace / metadata facts at implemented fidelity

## 8.2 Semantic preservation rule

Normalization may reshape data, rename fields, or drop backend-specific internals that are outside the canonical contract.

Normalization must not change the semantic truth of:
- whether the turn completed
- whether clarification is required
- whether approval is pending
- whether a continuation payload exists
- whether the execution failed

---

## 9. No-regression proof requirements

The proof must include direct-vs-adapter parity for the covered scenarios.

## 9.1 Parity rule

For each covered supported scenario, the adapter path and direct harness path must agree on:
- outcome class
- stop reason class
- presence or absence of continuation
- meaningful assistant message presence or absence

The exact object shape does not need to match because the adapter returns canonical execution types, not raw harness types.

## 9.2 No hidden ownership shifts

The proof must also demonstrate, by code structure and test expectations, that:
- turn-context is still assembled upstream
- continuation runtime is not called by the adapter as part of execution
- policy/session lifecycle APIs are not invoked by the adapter as execution side effects

---

## 10. Minimum test matrix

The proof is incomplete unless the test matrix includes all rows below.

| Scenario | Through adapter | Direct-vs-adapter parity | Negotiation asserted |
| --- | --- | --- | --- |
| Completed without tools | Required | Required | Required |
| Completed with tools | Required | Required | Required |
| Needs clarification | Required | Required | Required |
| Awaiting approval | Required | Required | Required |
| Unsupported or degraded request | Required | N/A | Required |
| Failed result mapping | Required | Optional if direct equivalent exists | Required where applicable |

---

## 11. Implementation boundaries for the proof

The following are explicitly out of contract for this proof:
- external provider adapters
- multi-backend runtime routing policy
- continuation persistence/resume
- approval decisioning or audit trails
- Relay-native collaboration execution through the adapter
- durable attachment pipelines
- broad context-window strategy or truncation policy
- public package extraction for execution adapter

If the implementation needs these to pass, the proving slice is too broad and should be reduced.

---

## 12. Required proof artifacts

The proof effort must leave behind these artifacts:
- implementation-driving scope doc
- explicit proof contract
- review verdict documenting whether the slice is actually ready to build

This document is the contract artifact.

---

## 13. Exit judgment

The adapter seam may be called **real** only when:

1. canonical `ExecutionRequest` is exercised end-to-end
2. the first-party harness executes behind an `ExecutionAdapter`
3. canonical `ExecutionResult` is produced end-to-end
4. negotiation truthfulness is proven, including one non-happy-path case
5. direct harness behavior is shown not to regress for covered scenarios
6. no ownership drift into policy, continuation, sessions, or turn-context is introduced

If any one of those is missing, the repo has documentation for a seam, but not yet a real proved seam.
