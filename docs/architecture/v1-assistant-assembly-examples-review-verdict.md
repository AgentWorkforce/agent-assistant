# v1 Assistant Assembly Examples Review Verdict

**Date:** 2026-04-12
**Review target:**
- `docs/architecture/v1-assistant-assembly-examples-contract.md`
- `docs/architecture/v1-assistant-assembly-examples-plan.md`
- `packages/examples/`
- updated consumer docs

## Verdict

**PASS_WITH_FOLLOWUPS**

The examples are directionally strong and materially improve consumer adoption. They are realistic enough to serve as copy-adapt references, they mostly respect the actual SDK boundaries, and they give Sage, MSD, and NightCTO a clearer assembly path than the repo had before.

The follow-ups are not cosmetic, though. A few docs overclaim what the examples prove, and the full-assembly example does not yet cover the complete proactive-to-policy shape the contract and consumer docs imply.

## Findings

### 1. Full assembly overstates the proactive-policy coverage

`packages/examples/src/05-full-assembly.ts` defines both `followUpToAction()` and `watchTriggerToAction()` but only exercises follow-up decisions. It does not register a watch rule, does not evaluate watch triggers, and does not demonstrate policy gating for watch-originated actions. That leaves the example short of the contract's intended "full assembly" shape for NightCTO-style adoption.

References:
- [packages/examples/src/05-full-assembly.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/05-full-assembly.ts:60)
- [packages/examples/src/05-full-assembly.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/05-full-assembly.ts:80)
- [packages/examples/src/05-full-assembly.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/05-full-assembly.ts:181)
- [packages/examples/src/05-full-assembly.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/05-full-assembly.ts:267)
- [docs/architecture/v1-assistant-assembly-examples-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-assistant-assembly-examples-contract.md:151)

Impact:
- Limits confidence that the examples concretely cover NightCTO's monitoring-heavy path.
- Makes the "canonical composition reference" claim somewhat broader than the current implementation.

### 2. Example 03 and the examples README claim proof scenarios that are not actually exercised

`03-policy-gated-assistant.ts` only simulates a low-risk path. The `deny`, `require_approval`, and `escalate` branches exist in code, but the example does not drive those outcomes. The README says the example shows "all four decision branches" and lists several scenarios as verifiable, but those are only inspectable, not demonstrated.

References:
- [packages/examples/src/03-policy-gated-assistant.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/03-policy-gated-assistant.ts:121)
- [packages/examples/src/03-policy-gated-assistant.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/src/03-policy-gated-assistant.ts:177)
- [packages/examples/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/README.md:23)
- [packages/examples/README.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/examples/README.md:71)

Impact:
- Reduces trust in the "proof scenario" framing.
- Weakens the adoption story for MSD, where policy behavior is a primary reason to adopt.

### 3. Consumer adoption guidance is internally inconsistent

The new v1 readiness sections are useful, but the older "Product-Specific Guidance" section still recommends starting with packages that the same document later marks as not ready for adoption. The largest contradiction is Sage starting with `memory` and NightCTO starting with `coordination` and `memory`, despite the later status table saying not to adopt those now.

References:
- [docs/consumer/how-products-should-adopt-relay-agent-assistant.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-products-should-adopt-relay-agent-assistant.md:54)
- [docs/consumer/how-products-should-adopt-relay-agent-assistant.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-products-should-adopt-relay-agent-assistant.md:91)
- [docs/consumer/how-products-should-adopt-relay-agent-assistant.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-products-should-adopt-relay-agent-assistant.md:154)

Impact:
- Blunts the concrete adoption benefit for Sage and NightCTO.
- Creates avoidable confusion for consumers trying to decide what to implement now.

## Assessment

### 1. Are the examples realistic and consumer-useful?

**Yes, mostly.**

They use credible product-owned seams:
- in-memory inbound/outbound adapters instead of fake framework magic
- product-owned trait values, policy rules, and proactive conditions
- explicit runtime lifecycle and subsystem registration
- realistic "copy this and replace the stub" patterns

That is consumer-useful for all three products. The main shortcoming is that some examples stop one step before the most adoption-critical proof points, especially around policy outcomes and full proactive coverage.

### 2. Do they reflect the actual SDK boundaries well?

**Yes, with minor caveats.**

This is one of the stronger parts of the work. The examples keep:
- assembly in product code
- package ownership separated
- no cross-package imports inside the SDK packages
- traits as read-only data that core stores but does not interpret
- proactive and policy composed externally rather than coupled internally

The only meaningful caveat is not a boundary violation but a scope gap: the full example claims a fuller proactive-policy bridge than it currently demonstrates.

### 3. Do they help NightCTO, Sage, and MSD adoption concretely?

**Yes, but unevenly.**

- **Sage:** Improved materially. `01`, `02`, and `04` give a usable path.
- **MSD:** Improved materially. `03` is the right shape, but it should prove more than the allow path.
- **NightCTO:** Improved, but `05` should cover watch-trigger-to-policy flow before it can be called the complete canonical reference.

The new `v1-product-adoption-matrix.md` helps a lot. The main drag on adoption clarity is the stale contradictory guidance in `how-products-should-adopt-relay-agent-assistant.md`.

## Required Follow-Ups

1. Extend `05-full-assembly.ts` to register at least one watch rule, evaluate a watch trigger, convert it with `watchTriggerToAction()`, and run that through policy.
2. Either drive non-allow outcomes in `03-policy-gated-assistant.ts` and `05-full-assembly.ts`, or tone down README claims so "proof scenarios" are clearly labeled as code-path inspection rather than executed behavior.
3. Reconcile `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` so the early product guidance matches the later v1 readiness table and adoption matrix.
4. Add one explicit `runtime.get('policy')` / `runtime.get('proactive')` retrieval in `05-full-assembly.ts` if that remains part of the claimed proof surface.

## What Was Reviewed

- Contract and plan documents for expected scope
- Example package inventory, README, and all five example source files
- Consumer docs updated for assembly and adoption guidance
- Exported SDK type surfaces for `core`, `traits`, `policy`, and `proactive`
- `packages/examples` typecheck run: passed

## Summary

The examples package is a real improvement and should ship as a reference set, but not as "fully complete with no follow-up needed." The core composition model is sound, the SDK boundaries are represented well, and the work will help adoption. The remaining work is to close the gap between what the docs claim and what the examples actually exercise.

V1_ASSISTANT_ASSEMBLY_EXAMPLES_REVIEW_COMPLETE
