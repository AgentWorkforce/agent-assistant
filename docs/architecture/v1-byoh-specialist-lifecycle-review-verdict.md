# v1 BYOH Specialist Lifecycle Review Verdict

**Date:** 2026-04-15
**Slice:** Third BYOH hardening slice
**Verdict:** ACCEPT_WITH_MINOR_SCOPE_NOTE

## Assessment

### 1. Is specialist lifecycle now fully awaited?

Yes.

`createRelayValidationHandler().start()` now owns the full register/subscribe/wait/validate/publish sequence and only resolves after verdict publish succeeds, returning `RelayValidationHandlerOutcome` rather than resolving after setup ([validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:216)).

`runByohLocalProof()` starts that lifecycle before publishing the execution result, then awaits the Relay-delivered verdict and finally awaits `handlerPromise` itself before returning ([byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:487), [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:519)).

That matches the boundary intent: `start()` now represents specialist completion, not specialist setup.

### 2. Are failures surfaced instead of swallowed?

Yes.

The previous detached async block and suppression path are gone. `subscription.waitForMessage()`, JSON parsing, validation, and `relay.publish()` now execute directly inside `start()` with no error-swallowing catch ([validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:239), [validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:264)).

The orchestrator now races verdict receipt against specialist failure so specialist timeout/publish failures reject the proof run instead of being masked behind an orchestrator timeout ([byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:488), [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:512)).

The new tests cover:

- specialist timeout propagation
- specialist publish failure propagation
- mismatched-thread execution-result rejection path

See [byoh-local-proof.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.test.ts:320).

### 3. Is thread/concurrency isolation materially improved?

Yes.

The specialist subscription now filters on both message type and `threadId`, eliminating the prior channel-wide execution-result consumption risk on shared channels ([validation-specialist.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/validation-specialist.ts:226)).

The orchestrator verdict subscription was already thread-scoped and remains so ([byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:466)). The new shared-channel concurrency test demonstrates that two proof runs can proceed concurrently without cross-consuming each other’s execution results or verdicts ([byoh-local-proof.test.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.test.ts:361)).

This is a material improvement, not just a nominal filter tweak.

### 4. What is the next continuation point after this slice?

The next continuation point is to close the no-regression checklist and remove scope drift before advancing to any further BYOH proof hardening:

1. Confirm the checklist items in `docs/architecture/v1-byoh-specialist-lifecycle-no-regression-checklist.md` against the final diff and test evidence.
2. Decide whether the incidental `createAgentRelayProofTransport.registerAgent()` reordering in [byoh-local-proof.ts](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/packages/harness/src/adapter/proof/byoh-local-proof.ts:325) should be reverted or explicitly accepted, because the boundary/checklist said transport behavior should remain unchanged in this slice.
3. If that scope note is resolved, treat the specialist lifecycle hardening slice as complete and carry the result forward into the next BYOH architectural boundary/review step.

## Scope Note

I did not find a blocking lifecycle defect in the hardening itself. The one review note is scope control: `createAgentRelayProofTransport.registerAgent()` was modified even though the checklist says transport behavior should remain unchanged for this slice. That change does not invalidate the lifecycle hardening verdict, but it should be cleaned up or explicitly justified before closing the checklist.

## Validation Context Considered

- `tsc -p tsconfig.json`
- `vitest run`
- 32/32 tests passing, including new specialist timeout, publish failure, and thread-isolation coverage

## Summary

The third BYOH hardening slice meets its core goals. Specialist lifecycle is now fully awaited, specialist-side failures propagate instead of being swallowed, and shared-channel thread isolation is materially stronger. I produced this review artifact:

- `docs/architecture/v1-byoh-specialist-lifecycle-review-verdict.md`

V1_BYOH_SPECIALIST_LIFECYCLE_REVIEW_COMPLETE
