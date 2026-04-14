# v1 Execution Adapter Proof Slice

**Date:** 2026-04-14  
**Status:** PROPOSED / IMPLEMENTATION_DRIVING  
**Prerequisites:**
- `docs/architecture/v1-execution-adapter-boundary.md`
- `docs/specs/v1-execution-adapter-spec.md`
- `docs/architecture/v1-harness-boundary.md`
- `docs/specs/v1-harness-spec.md`
- `docs/architecture/v1-turn-context-implementation-boundary.md`
- `docs/specs/v1-turn-context-enrichment-spec.md`
- `docs/architecture/agent-assistant-runtime-primitive-map.md`

---

## 1. Purpose

The next step is **not** external Claude/Codex support.

The next step is to make the execution-adapter seam real by routing one canonical Agent Assistant turn through:

```text
turn-context assembly
  -> canonical ExecutionRequest
  -> execution adapter
  -> current first-party harness
  -> normalized ExecutionResult
```

This proof exists to answer one narrow question:

> Can Agent Assistant hand a product-prepared turn to a real adapter contract, target the existing first-party harness behind that seam, and get back normalized execution outcomes without collapsing product/runtime ownership into the harness?

If the answer is yes, the boundary is no longer aspirational. It becomes a real internal integration point that external backends can later target.

---

## 2. Exact proving target

## Recommended target

Implement the **first internal adapter-backed execution proof** using the existing harness as backend `agent-assistant-harness`.

The proving target is complete only when all of the following are true:

1. a canonical `ExecutionRequest` can be built directly from real `turn-context` output plus the inbound user message
2. an internal first-party adapter can negotiate and execute that request against the current `@agent-assistant/harness`
3. the adapter returns a spec-shaped `ExecutionResult` rather than a raw `HarnessResult`
4. the result preserves truthful bounded-turn semantics already owned by harness
5. direct-to-harness behavior is not regressed for the covered turn classes

### Concrete target statement

> Prove that one bounded Agent Assistant turn can flow from `TurnContextAssembly.harnessProjection` into `ExecutionRequest`, through a first-party `ExecutionAdapter`, into `HarnessRuntime.runTurn()`, and back out as normalized `ExecutionResult` for the current harness backend.

This is the smallest proof that makes the adapter contract operational without broadening into BYOH provider work.

---

## 3. Why this is the right first slice

This slice is intentionally narrow because it proves the highest-risk architectural claim first:
- that the adapter seam is real
- that the current harness can sit behind it
- that product/runtime layers can remain canonical above it

It avoids the two common failure modes:

1. **Fake seam**  
   The “adapter” is just a renamed direct harness call with no negotiation, no contract mapping, and no normalized result shape.

2. **Premature externalization**  
   The team jumps to Claude/Codex integration before the canonical request/result contract has been proven internally against a backend already understood by the repo.

The first-party harness is the correct proving backend because:
- it already owns real bounded turn execution semantics
- its outcome model is richer than simple text completion
- it already exercises continuation and truthful stop behavior
- regressions are visible immediately because direct harness behavior already exists

---

## 4. Bounded scope of the proof

## In scope

The proof slice must exercise these responsibilities first.

### 4.1 Canonical request assembly at the adapter seam

Use real turn-context output as the upstream source of:
- `instructions`
- `context`
- assistant / turn / session identifiers

Then add the inbound user message and any selected tool descriptors into one canonical `ExecutionRequest`.

This proves the adapter input is **post-assembly** and does not absorb turn-context ownership.

### 4.2 Capability description and request negotiation

The internal harness adapter must implement:
- `describeCapabilities()`
- `negotiate(request)`
- truthful `supported` / `degraded` reporting for the exercised scenarios

For the proving slice, negotiation must cover at least:
- tool-bearing request supported by current harness backend
- no-degradation happy path
- one explicit unsupported or degraded path proven in tests

### 4.3 Canonical-to-harness translation

The adapter must map:
- `ExecutionRequest.message` -> `HarnessUserMessage`
- `ExecutionRequest.instructions` -> `HarnessInstructions`
- `ExecutionRequest.context` -> `HarnessPreparedContext`
- `ExecutionRequest.continuation` -> `HarnessContinuation` when supplied
- selected tools -> harness tool availability / allowlist path

This is the first concrete proof that the seam translates canonical turn intent into backend-native invocation.

### 4.4 Harness-to-canonical result normalization

The adapter must normalize current harness outcomes into `ExecutionResult`, including at minimum:
- `completed`
- `needs_clarification`
- `awaiting_approval`
- `failed`

`deferred` is useful but not required for the first proving slice if it materially broadens implementation. It may be included if it falls out naturally from the mapping.

Normalization must include:
- outcome
- stop reason
- assistant message when present
- continuation payload when present
- trace summary / execution facts at the fidelity the current harness can honestly provide

### 4.5 No-regression path against current harness behavior

The proof must show that, for the covered scenarios, going through the adapter seam preserves the same bounded execution truthfulness already provided by direct harness invocation.

---

## 5. Exact scenarios required in the first proof

The proof slice is implementation-ready only if it covers these four scenarios.

### Scenario A — completed, no tools

A product-prepared turn with:
- assembled instructions/context
- no tools required
- current harness backend

Expected proof:
- negotiation returns `supported: true`
- adapter executes successfully
- `ExecutionResult.outcome === 'completed'`
- result shape is canonical, not raw harness-shaped

### Scenario B — completed, tool-bearing turn

A product-prepared turn with:
- at least one canonical tool descriptor
- current harness tool loop exercised through the adapter

Expected proof:
- negotiation reports tool support truthfully
- adapter translates tool descriptors into harness-usable tool availability
- a successful tool-bearing turn returns canonical `ExecutionResult`

This scenario matters because without it the seam is too shallow and risks becoming “prompt in / text out” only.

### Scenario C — needs clarification

A turn that forces the harness to stop with clarification.

Expected proof:
- `ExecutionResult.outcome === 'needs_clarification'`
- continuation payload is preserved as normalized adapter output
- adapter does not own continuation persistence or resume lifecycle

This proves the adapter can carry resumable stop semantics without swallowing continuation ownership.

### Scenario D — awaiting approval

A turn that causes the current harness to stop pending approval.

Expected proof:
- `ExecutionResult.outcome === 'awaiting_approval'`
- any normalized approval request / continuation fields are preserved
- adapter does not evaluate policy or record approvals

This proves the approval seam survives the adapter boundary without collapsing policy into execution.

---

## 6. What stays out of scope

The first proof must **not** broaden into the following.

### 6.1 External backend integrations

Out of scope:
- Claude adapter
- Codex adapter
- OpenAI/Anthropic/Google backend wiring
- user-supplied credentials or billing flows

Reason: the point of this slice is to prove the seam first, not the external market surface.

### 6.2 Multi-backend routing policy

Out of scope:
- runtime selection across many backends
- automatic reroute logic
- product routing heuristics beyond choosing the internal harness adapter in test/proof paths

Reason: backend selection policy belongs above the adapter and does not need to be solved to prove the seam exists.

### 6.3 Continuation runtime integration

Out of scope:
- continuation record creation
- persistence
- resume triggers
- resumed turn delivery

Reason: the proof only needs to show that continuation-shaped input/output survives the adapter contract honestly.

### 6.4 Policy engine integration

Out of scope:
- risk classification
- allow/deny policy decisions
- approval storage or audit ownership

Reason: the proof only needs to show that approval-blocked execution normalizes correctly.

### 6.5 Relay-native coordination

Out of scope:
- relayauth
- relayfile
- relaycron
- multi-agent collaboration through Relay channels

Reason: those primitives remain canonical outside the adapter. The first proof should not entangle them.

### 6.6 Rich degradation matrix

Out of scope for the first slice:
- deep context-pressure behavior
- attachment degradation across mismatched backends
- opaque-resume vs structured-resume differences across many providers
- detailed provider-native trace translation diversity

Reason: first prove one backend cleanly before building a broad degradation taxonomy from hypothetical providers.

---

## 7. Adapter responsibilities exercised first

The adapter responsibilities should be implemented in this order.

### Priority 1 — request/result contract reality

Make `ExecutionRequest` -> `ExecutionResult` real against a live backend.

If this is not done first, the boundary remains theoretical.

### Priority 2 — capability truthfulness

Support `describeCapabilities()` and `negotiate()` with real values for the first-party harness backend.

If this is skipped, the seam cannot honestly support future backend mismatch handling.

### Priority 3 — bounded semantic normalization

Normalize the harness outcomes that most clearly prove the seam is not just a text wrapper:
- tool-bearing completion
- clarification stop
- approval stop

### Priority 4 — minimal trace normalization

Surface normalized execution facts sufficient to inspect:
- backend used
- whether tools were exercised
- outcome class
- whether continuation was returned
- whether result was degraded

Detailed backend-specific trace richness can come later.

---

## 8. No-regression guarantees required

The proof slice must preserve the current harness contract rather than reinterpreting it.

## Required guarantees

### 8.1 Harness remains the execution owner

The adapter must not re-implement harness loop behavior.
It must delegate to `HarnessRuntime.runTurn()` for the actual bounded turn.

### 8.2 Turn-context remains the assembly owner

The adapter must accept assembled instructions/context.
It must not start composing identity, enrichment, or guardrails.

### 8.3 Continuation ownership remains external

The adapter may pass through continuation input/output.
It must not persist, revive, expire, or manage continuation records.

### 8.4 Policy ownership remains external

The adapter may surface `awaiting_approval` or approval-shaped metadata.
It must not decide whether something should be approved.

### 8.5 Existing direct harness semantics remain stable

For the covered scenarios, direct harness invocation and adapter-backed invocation must agree on:
- outcome class
- truthful stop semantics
- continuation presence/absence
- meaningful assistant message presence/absence

The adapter may reshape data into canonical execution types, but it must not change the semantic truth of the result.

### 8.6 No product flattening

The proof must preserve the architecture that:
- product identity stays upstream
- Relay stays external to the adapter
- execution backend stays replaceable

If the implementation requires product code to become harness-shaped everywhere again, the proof has failed.

---

## 9. What proof is required to say the seam is real

The adapter seam becomes real only when the repo has all of the following.

## 9.1 An internal first-party adapter implementation target

A concrete internal adapter exists for backend id `agent-assistant-harness` and conforms to the execution adapter spec.

## 9.2 A canonical request construction path

There is a real construction path from:
- inbound user message
- `TurnContextAssembly.harnessProjection`
- selected tools / continuation / metadata

into one `ExecutionRequest`.

This may live in product/runtime integration code, but it must exist and be exercised by proof tests.

## 9.3 Adapter-backed execution tests

The test suite must prove the four scenarios in Section 5 through the adapter entry point, not by asserting private helper mappings only.

## 9.4 Direct-vs-adapter parity assertions

At least the covered scenarios must include parity checks showing the adapter path does not distort harness semantics.

## 9.5 One explicit unsupported or degraded negotiation case

The proof must include at least one request that the internal harness adapter reports as degraded or unsupported through `negotiate()`.

This matters because an adapter seam that only proves happy-path support has not yet proven truthful capability signaling.

Recommended minimal case:
- request requires an unsupported capability the first proof intentionally does not implement through the adapter path
- `negotiate()` returns `supported: false` or `degraded: true` with structured reason code

## 9.6 Documentation tying the proof to the architecture boundary

The proof must produce docs that say exactly:
- what was proven
- what remains unproven
- what can now proceed safely

---

## 10. Recommended implementation posture

## Build the proof around one internal adapter

Recommended internal name:
- `AgentAssistantHarnessExecutionAdapter`

Recommended backend id:
- `agent-assistant-harness`

### Keep the integration thin

The adapter should be intentionally thin:
- capability declaration
- negotiation logic
- type translation in
- delegation to harness runtime
- normalization out

It should **not** become a second harness layer.

### Prefer proof tests over breadth

It is better to prove:
- 4 real scenarios
- 1 truthful unsupported/degraded negotiation
- direct-vs-adapter parity

than to gesture at every future provider feature.

---

## 11. Exit criteria

This proving slice is complete when:

1. the current harness can be invoked through the execution adapter contract
2. canonical request/result shapes are used end-to-end
3. covered outcomes normalize correctly
4. at least one unsupported/degraded negotiation path is proven
5. no-regression parity with direct harness behavior is demonstrated for covered cases
6. docs clearly state that external adapters are still out of scope

When those criteria are met, the execution-adapter boundary is no longer speculative.
It becomes a real internal seam that future external backends can target.

---

## 12. Final recommendation

**Recommended proving target:**

> Ship the first internal proof by routing a canonical `ExecutionRequest` through a first-party `agent-assistant-harness` execution adapter into today’s harness runtime, and prove completion, tool-bearing execution, clarification stop, approval stop, plus one truthful negotiation failure/degradation case.

That is the narrowest slice that makes the adapter contract real without prematurely expanding into external provider integration.
