# v1 Proactive Policy Integration Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

## Verdict

**FAIL**

## Findings

### 1. Contract, proof, and implementation disagree on follow-up reminder state after policy gating

This is the main blocker.

- The contract says denied proactive follow-ups must **not** count against reminder state, and says the product should **not** call back into the proactive engine to record the denial ([docs/architecture/v1-proactive-policy-integration-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-contract.md:170), [docs/architecture/v1-proactive-policy-integration-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-contract.md:180)).
- The proactive implementation increments reminder state immediately when `evaluateFollowUp()` returns `fire`, before any policy decision exists ([packages/proactive/src/proactive.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/proactive/src/proactive.ts:244)).
- The integration proof and tests explicitly rely on that incremented state and treat the resulting cooldown suppression as evidence of correct isolation ([docs/architecture/v1-proactive-policy-integration-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-proof.md:82), [docs/architecture/v1-proactive-policy-integration-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-proof.md:168), [packages/integration/src/integration.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/integration/src/integration.test.ts:228)).

These statements cannot all be true at once. As shipped, a denied or approval-blocked follow-up does affect proactive reminder state unless product code actively calls `resetReminderState()`, which the contract currently says it should not do. That makes the runtime model incoherent.

### 2. The integration proof does not cover key watch-trigger runtime cases from the contract

The proof covers watch-trigger `allow` and `escalate`, and mixed audit visibility, but it does not prove the contract’s watch-specific behavior for `require_approval` or `deny`.

- The contract makes explicit claims that watch triggers re-schedule independently when denied, approval-blocked, or escalated ([docs/architecture/v1-proactive-policy-integration-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-contract.md:170), [docs/architecture/v1-proactive-policy-integration-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-contract.md:171), [docs/architecture/v1-proactive-policy-integration-contract.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-contract.md:172)).
- The proof only names watch coverage for `allow`, `escalate`, and mixed audit presence ([docs/architecture/v1-proactive-policy-integration-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-proof.md:71), [docs/architecture/v1-proactive-policy-integration-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-proof.md:92), [docs/architecture/v1-proactive-policy-integration-proof.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-proof.md:115)).

That is not enough to claim the integration proof covers the key runtime cases. The missing cases matter because watch rules have their own scheduling lifecycle, and that behavior is central to the integration contract.

## Assessment

### 1. Is the boundary between packages still clean?

**Yes.**

`@relay-assistant/proactive` and `@relay-assistant/policy` still do not depend on each other directly. The only place both type namespaces meet is the private integration helper layer in [packages/integration/src/helpers.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/integration/src/helpers.ts:15), and neither package manifest introduces a dependency on the other. On package-boundary cleanliness alone, this passes.

### 2. Does the integration proof cover the key runtime cases?

**No.**

It proves the happy path, escalation, basic approval recording, and audit traceability, and `npm test` in `packages/integration` passes with 14/14 tests. But it does not cover all contract-significant watch-trigger cases, and one of its core assertions directly conflicts with the contract’s reminder-state semantics for follow-ups.

### 3. Is the approval/audit correlation story coherent?

**Mostly yes, with one limitation.**

The policy-side correlation path is coherent:

- `evaluate()` returns `auditEventId` and records the initial audit event ([packages/policy/src/policy.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/policy/src/policy.ts:140)).
- `recordApproval()` looks up that event, emits a second audit event, and preserves the original action context ([packages/policy/src/policy.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/policy/src/policy.ts:156)).
- The integration tests verify approved, denied, and unknown-ID cases ([packages/integration/src/integration.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/integration/src/integration.test.ts:339), [packages/integration/src/integration.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/integration/src/integration.test.ts:380), [packages/integration/src/integration.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/integration/src/integration.test.ts:406)).

The limitation is that the approval/audit story is coherent only within policy. It does not resolve the larger reminder-state inconsistency on the proactive side.

## Required Follow-Ups

1. Reconcile the contract and proof with the actual proactive reminder-state behavior.
2. Choose one model explicitly:
   - reminder state advances on `fire` before policy and product may call `resetReminderState()` after deny/escalate/unapproved approval, or
   - the proactive API changes so reminder state is only committed after delivery.
3. Add integration tests for watch-trigger `require_approval` and `deny`, including proof that watch re-scheduling remains correct.
4. Update the proof doc after those semantics are settled; right now it documents behavior that conflicts with the contract.

## Review Summary

The package boundary remains clean, and the policy approval/audit correlation mechanism is implemented and tested. The integration work still fails review because the runtime semantics for denied or approval-blocked follow-ups are contradictory across contract, proof, and implementation, and because watch-trigger gating coverage is incomplete.

Artifact produced: [docs/architecture/v1-proactive-policy-integration-review-verdict.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-proactive-policy-integration-review-verdict.md:1)

V1_PROACTIVE_POLICY_INTEGRATION_REVIEW_COMPLETE
