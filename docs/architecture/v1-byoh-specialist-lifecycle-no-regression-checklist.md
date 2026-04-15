# v1 BYOH Specialist Lifecycle Hardening No-Regression Checklist

**Date:** 2026-04-15
**Status:** ACTIVE
**Depends on:**
- `docs/architecture/v1-byoh-specialist-lifecycle-boundary.md`
- `docs/architecture/v1-byoh-relay-native-followup-no-regression-checklist.md`

---

## Purpose

This checklist defines the exact no-regression constraints for the specialist lifecycle hardening slice. Every item must be verified before the slice is considered complete.

This checklist is **additive** to the follow-up no-regression checklist (`v1-byoh-relay-native-followup-no-regression-checklist.md`). All items in that checklist remain in force. This document adds constraints specific to the lifecycle hardening refactor.

---

## 1. Execution adapter — no regression

### 1.1 Claude Code adapter unchanged

- [ ] `ClaudeCodeExecutionAdapter` source file (`claude-code-adapter.ts`) is not modified
- [ ] `describeCapabilities()` returns identical output
- [ ] `negotiate()` returns identical output for identical requests
- [ ] `execute()` behavior is unchanged
- [ ] all existing adapter unit tests (`claude-code-adapter.test.ts`) pass without modification

### 1.2 Adapter types unchanged

- [ ] `ExecutionAdapter`, `ExecutionRequest`, `ExecutionResult`, `ExecutionCapabilities`, `ExecutionNegotiation`, `ExecutionToolDescriptor`, `ExecutionRequirements`, `ExecutionTrace` interfaces unchanged
- [ ] no existing adapter type removed or narrowed

---

## 2. Validation specialist — behavioral preservation

### 2.1 Core validation logic unchanged

- [ ] `parseExecutionResult()` function body is unchanged
- [ ] `summarize()` function body is unchanged
- [ ] `validateExecutionResult()` function body is unchanged (same parse/validate/emit logic)
- [ ] the same connectivity signals are emitted for the same inputs:
  - [ ] `confidence.high` for completed, non-degraded results
  - [ ] `confidence.low` for unsupported/failed results
  - [ ] `escalation.uncertainty` for degraded or unparseable results
  - [ ] `handoff.ready` on every completion
- [ ] signal emission order is preserved

### 2.2 `createValidationSpecialist()` preserved

- [ ] the `createValidationSpecialist()` function still exists and returns a valid `Specialist`
- [ ] the `Specialist` handler `execute()` method still works with direct invocation
- [ ] the function signature is unchanged

### 2.3 `createRelayValidationHandler()` — controlled changes only

- [ ] the function signature is unchanged (same config shape)
- [ ] `start()` still registers the specialist agent on the channel
- [ ] `start()` still subscribes to the channel for `execution-result` messages
- [ ] `start()` still validates received execution results using the same `validateExecutionResult()` logic
- [ ] `start()` still publishes `validation-verdict` to the channel
- [ ] `start()` still emits the same connectivity signals during validation
- [ ] `stop()` still unsubscribes and prevents further processing

### 2.4 Intended `createRelayValidationHandler()` changes

- [ ] `start()` now resolves only after the full receive/validate/publish lifecycle completes (not after setup)
- [ ] `start()` now rejects on any lifecycle failure (timeout, parse, validation, publish)
- [ ] `start()` now returns `RelayValidationHandlerOutcome` instead of `void`
- [ ] the specialist subscription filter now includes `threadId === config.threadId` in addition to `type === 'execution-result'`
- [ ] no `.catch(() => undefined)` or equivalent error suppression remains

### 2.5 Specialist does not gain new ownership

- [ ] specialist does not invoke Claude Code CLI
- [ ] specialist does not own assistant identity
- [ ] specialist does not manage Relay lifecycle (start/shutdown)

---

## 3. Connectivity — no regression

### 3.1 Signal emission unchanged

- [ ] the specialist emits the same connectivity signals for the same execution results
- [ ] signal classes used: `confidence.high`, `confidence.low`, `escalation.uncertainty`, `handoff.ready` — no new signal classes added
- [ ] message classes used: `confidence`, `escalation`, `handoff` — no new message classes added
- [ ] `ConnectivityLayer` interface not modified

### 3.2 Connectivity role unchanged

- [ ] connectivity does not carry execution results between participants
- [ ] connectivity does not carry validation verdicts between participants
- [ ] connectivity is used only for signal emission and query

---

## 4. Relay transport — no regression

### 4.1 `ProofRelayTransport` interface unchanged

- [ ] `registerAgent()` signature unchanged
- [ ] `publish()` signature unchanged
- [ ] `subscribe()` signature unchanged
- [ ] `shutdown()` signature unchanged
- [ ] no methods added, removed, or renamed

### 4.2 `createAgentRelayProofTransport` unchanged

- [ ] the function is not modified in this slice
- [ ] all existing transport behavior preserved

### 4.3 Message protocol unchanged

- [ ] `RelayExecutionResultMessage` type unchanged
- [ ] `RelayValidationVerdictMessage` type unchanged
- [ ] `RelayValidationVerdict` type unchanged
- [ ] `RelayChannelMessage` type unchanged
- [ ] `RelaySubscription` type unchanged

---

## 5. Proof harness — controlled changes only

### 5.1 Config unchanged

- [ ] `ByohLocalProofConfig` interface unchanged
- [ ] all fields retain their types and optionality

### 5.2 Result shape — additive only

- [ ] `ByohLocalProofResult` existing fields unchanged: `scenario`, `executionResult`, `validationVerdict`, `signals`, `relayCoordinated`, `relayRoundTrip`, `identityPreserved`, `request`
- [ ] if `specialistOutcome` is added, it is optional and does not change existing field semantics

### 5.3 Orchestrator flow — controlled changes

- [ ] `runByohLocalProof()` still registers orchestrator and specialist
- [ ] `runByohLocalProof()` still publishes execution-result to Relay
- [ ] `runByohLocalProof()` still waits for validation-verdict from Relay
- [ ] `runByohLocalProof()` still synthesizes final result from Relay-delivered verdict
- [ ] `runByohLocalProof()` still calls `validationHandler.stop()` and `verdictSubscription.unsubscribe()` in finally block
- [ ] `runByohLocalProof()` now awaits `handlerPromise` for its full lifecycle (not just setup)
- [ ] specialist errors now propagate as rejections of `runByohLocalProof()`

### 5.4 Proof scenarios unchanged

- [ ] all four scenario types still defined and exercised
- [ ] scenario message, tools, and requirements shapes unchanged

---

## 6. Test changes — controlled

### 6.1 Existing tests unchanged

- [ ] all four scenario happy-path tests pass without modification
- [ ] the "drops specialist verdict" centrality test passes without modification
- [ ] no existing test assertions changed

### 6.2 New tests are additive

- [ ] new test: specialist timeout error propagates to `runByohLocalProof` rejection
- [ ] new test: specialist publish failure propagates (or equivalent failure-transparency test)
- [ ] new test: concurrent/sequential proof runs with different threadIds on same channel do not cross-consume
- [ ] new test: message with mismatched threadId is ignored by specialist

---

## 7. Package boundaries — no leakage

### 7.1 Only proof files modified

- [ ] changes are confined to `packages/harness/src/adapter/proof/` directory
- [ ] `packages/harness/src/adapter/types.ts` not modified
- [ ] `packages/harness/src/adapter/claude-code-adapter.ts` not modified
- [ ] `packages/harness/src/adapter/index.ts` only modified for additive re-exports (if needed)

### 7.2 No upstream package modifications

- [ ] `@agent-assistant/coordination` not modified
- [ ] `@agent-assistant/connectivity` not modified
- [ ] `@agent-assistant/traits` not modified
- [ ] `@agent-assistant/turn-context` not modified
- [ ] `@agent-assistant/policy` not modified
- [ ] `@agent-assistant/sessions` not modified
- [ ] `@agent-assistant/continuation` not modified
- [ ] `@agent-assistant/sdk` not modified

---

## 8. Build and test

### 8.1 Build

- [ ] `npm run build --workspace @agent-assistant/harness` succeeds with no new errors
- [ ] `tsc -p tsconfig.json` passes
- [ ] no new TypeScript compilation warnings in existing packages

### 8.2 Existing tests

- [ ] all pre-existing adapter unit tests pass without modification
- [ ] all pre-existing package tests outside the proof directory pass without modification

### 8.3 New and updated tests

- [ ] all four proof scenario happy-path tests pass
- [ ] Relay centrality test passes
- [ ] specialist failure-transparency tests pass
- [ ] thread-isolation tests pass
- [ ] mismatched-thread test passes

---

## 9. Verification procedure

Run in order:

```bash
# 1. Build harness
npm run build --workspace @agent-assistant/harness

# 2. Type check
npx tsc -p tsconfig.json --noEmit

# 3. Existing adapter unit tests (no regression)
npx vitest run packages/harness/src/adapter/claude-code-adapter.test.ts

# 4. Updated proof integration tests
npx vitest run packages/harness/src/adapter/proof/

# 5. Full workspace build (no regression)
npm run build

# 6. Full workspace tests (no regression)
npm test
```

All must pass. Any failure is a regression.
