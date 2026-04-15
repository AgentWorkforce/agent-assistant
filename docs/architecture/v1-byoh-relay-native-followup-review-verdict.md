# v1 BYOH Relay-Native Follow-up Review Verdict

**Date:** 2026-04-15  
**Scope reviewed:**
- `docs/architecture/v1-byoh-relay-native-followup-boundary.md`
- `packages/harness/src/adapter/proof/byoh-local-proof.ts`
- `packages/harness/src/adapter/proof/validation-specialist.ts`
- `packages/harness/src/adapter/proof/byoh-local-proof.test.ts`
- Provided build/test validation output

## Verdict

**PARTIAL_ACCEPT**

The slice succeeds at making Relay structurally mandatory for the proof and moves the specialist exchange onto Relay channel traffic. That is a real architectural improvement over the prior Relay-adjacent shape. However, the implementation still has coordination robustness gaps that keep this from being a full accept.

## Findings

1. **High:** Specialist execution is detached and its failures are swallowed, so the proof does not actually await the Relay-native specialist path end-to-end. In [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:210), `start()` returns after registration/subscription setup, then launches the actual wait/validate/publish flow in a fire-and-forget async block. That block ends with `.catch(() => undefined)` at [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:263), so validation/publish failures are suppressed. `runByohLocalProof()` then treats `await handlerPromise` as if the specialist flow had completed at [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:487). In practice, the orchestrator only waits for a verdict timeout, not for specialist success/failure. That weakens the claim that specialist coordination is fully proven through Relay-native flow.

2. **Medium:** The specialist subscription is channel-wide rather than thread-scoped, so concurrent proofs on the same channel can cross-consume execution results. The specialist filter only checks `type === 'execution-result'` at [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:217), while the orchestrator verdict subscription is thread-filtered at [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:466). This is acceptable for a single-run proof harness, but it is the next structural limit: Relay is central, yet the specialist flow is not isolated strongly enough to support multiple in-flight proof runs on one channel.

## Assessment

### 1. Is Relay now structurally central?

**Yes, materially.**

Evidence:
- `relay` and `relayConfig` are now required in `ByohLocalProofConfig` at [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:143).
- The old coordinator-driven proof path has been removed from `runByohLocalProof()`.
- The proof now publishes `execution-result` and waits for `validation-verdict` over Relay in [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:494).
- The test suite includes a centrality failure case where dropping the specialist verdict causes timeout/failure in [byoh-local-proof.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.test.ts:281).

This is enough to say Relay is now load-bearing in the proof.

### 2. Does specialist coordination really occur through Relay-native flow?

**Mostly yes, but not yet with fully robust lifecycle handling.**

Evidence:
- The specialist receives work by subscribing to Relay and waiting for an `execution-result` message in [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:217).
- The specialist returns its verdict by publishing `validation-verdict` back to Relay in [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:257).
- The orchestrator consumes the verdict from Relay rather than from a direct coordinator return value in [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:510).

The remaining limitation is that the specialist worker loop is detached and error-suppressing, so the proof demonstrates Relay-mediated coordination, but not a fully joined and failure-transparent Relay lifecycle.

### 3. Is connectivity still secondary/helper rather than primary?

**Yes.**

Connectivity is now used for emitted signals and later inspection, not for passing the execution result to the specialist or the verdict back to the orchestrator. The result transfer and verdict transfer both happen over Relay, while `connectivity.query({ threadId })` is only used to retrieve emitted signals after the Relay verdict arrives at [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:520).

### 4. What remains as the next continuation point?

The next continuation point is to harden the Relay-native specialist lifecycle so the proof is not just Relay-central, but Relay-correct under failure and concurrency:

1. Make `createRelayValidationHandler().start()` represent the actual receive/validate/publish lifecycle instead of only setup.
2. Stop swallowing specialist-path errors; surface them directly to `runByohLocalProof()`.
3. Thread-scope the specialist subscription filter so multiple proof runs can share a channel without cross-talk.
4. Add a test that exercises concurrent proof runs or mismatched thread traffic on the same channel.

## Validation readout

The supplied validation output shows:
- `tsc -p tsconfig.json` passed
- `vitest run` passed
- 3 test files, 28 tests passed

That output supports the claim that the slice is currently green, but it does not remove the structural issues above because both are lifecycle/isolation gaps rather than compile or happy-path failures.

## Summary

This review produced one artifact:
- `docs/architecture/v1-byoh-relay-native-followup-review-verdict.md`

Overall result: Relay is now structurally central, specialist coordination is substantially Relay-native, and connectivity has been pushed into the helper role. The remaining work is to make the specialist Relay path fully awaited, failure-transparent, and thread-isolated.

V1_BYOH_RELAY_NATIVE_FOLLOWUP_REVIEW_COMPLETE
