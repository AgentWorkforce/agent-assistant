# v1 BYOH Relay-Native Follow-up No-Regression Checklist

**Date:** 2026-04-15
**Status:** ACTIVE
**Depends on:**
- `docs/architecture/v1-byoh-relay-native-followup-boundary.md`
- `docs/architecture/v1-byoh-local-relay-sdk-no-regression-checklist.md`

---

## Purpose

This checklist defines the exact no-regression constraints for the Relay-native follow-up slice. Every item must be verified before the follow-up is considered complete.

This checklist is **additive** to the original no-regression checklist (`v1-byoh-local-relay-sdk-no-regression-checklist.md`). All items in the original checklist remain in force. This document adds constraints specific to the Relay-native refactor.

---

## 1. Execution adapter — no regression

### 1.1 Claude Code adapter unchanged

- [ ] `ClaudeCodeExecutionAdapter` source file (`claude-code-adapter.ts`) is not modified
- [ ] `describeCapabilities()` returns identical output
- [ ] `negotiate()` returns identical output for identical requests
- [ ] `execute()` behavior is unchanged — same CLI invocation, same result normalization
- [ ] all existing adapter unit tests (`claude-code-adapter.test.ts`) pass without modification

### 1.2 Adapter types unchanged

- [ ] `ExecutionAdapter` interface unchanged
- [ ] `ExecutionRequest` interface unchanged
- [ ] `ExecutionResult` interface unchanged
- [ ] `ExecutionCapabilities` interface unchanged
- [ ] `ExecutionNegotiation` interface unchanged
- [ ] `ExecutionToolDescriptor` interface unchanged
- [ ] `ExecutionRequirements` interface unchanged
- [ ] `ExecutionTrace` interface unchanged
- [ ] no existing adapter type removed or narrowed

---

## 2. Validation specialist — behavioral preservation

### 2.1 Validation logic unchanged

- [ ] the same parse/validate/summarize logic runs regardless of whether input arrives from Relay or from direct invocation
- [ ] `parseExecutionResult()` function is unchanged
- [ ] `summarize()` function is unchanged
- [ ] the same connectivity signals are emitted for the same inputs:
  - [ ] `confidence.high` for completed, non-degraded results
  - [ ] `confidence.low` for unsupported/failed results
  - [ ] `escalation.uncertainty` for degraded or unparseable results
  - [ ] `handoff.ready` on every completion
- [ ] signal emission order is preserved

### 2.2 Specialist `Specialist` interface preserved

- [ ] the existing `createValidationSpecialist()` function still works and returns a valid `Specialist`
- [ ] the `Specialist` handler implementation is not removed (it may be bypassed in the proof, but it must still exist and function)
- [ ] any code that previously used the specialist via `coordinator.execute()` still compiles (even if the proof no longer exercises that path)

### 2.3 Specialist does not gain new ownership

- [ ] specialist does not invoke Claude Code CLI
- [ ] specialist does not own assistant identity
- [ ] specialist does not manage Relay lifecycle (start/shutdown) — it only publishes/subscribes

---

## 3. Connectivity — no regression

### 3.1 Signal emission unchanged

- [ ] the specialist emits the same connectivity signals for the same execution results
- [ ] signal classes used: `confidence.high`, `confidence.low`, `escalation.uncertainty`, `handoff.ready` — no new signal classes added
- [ ] message classes used: `confidence`, `escalation`, `handoff` — no new message classes added
- [ ] `ConnectivityLayer` interface not modified
- [ ] existing connectivity tests pass without modification

### 3.2 Connectivity role clarified, not expanded

- [ ] connectivity does not carry execution results between participants
- [ ] connectivity does not carry validation verdicts between participants
- [ ] connectivity is used only for signal emission and query within the specialist's local scope

---

## 4. Coordination package — no regression

### 4.1 Coordination types unchanged

- [ ] `Coordinator` interface unchanged
- [ ] `Specialist` interface unchanged
- [ ] `SpecialistRegistry` interface unchanged
- [ ] `DelegationPlan` type unchanged
- [ ] `CoordinationTurn` type unchanged
- [ ] `SpecialistResult` type unchanged
- [ ] existing coordination tests pass without modification

### 4.2 Coordinator usage clarified

- [ ] the `coordinator` field is removed from `ByohLocalProofConfig`, but `createCoordinator` and `createSpecialistRegistry` are still importable and functional
- [ ] no coordinator source code is modified
- [ ] the coordinator may still be used internally for connectivity signal aggregation, but it is not the primary coordination path for the proof

---

## 5. Proof harness — controlled changes only

### 5.1 Config changes are intentional

- [ ] `relay` field changed from optional to required — this is the intended change
- [ ] `relayConfig` field changed from optional to required — this is the intended change
- [ ] `coordinator` field removed from config — this is the intended change
- [ ] `assembler`, `adapter`, `connectivity`, `traitsProvider` fields unchanged

### 5.2 Result shape changes are intentional

- [ ] `validationResult: SpecialistResult` replaced by `validationVerdict` with Relay-native shape — this is the intended change
- [ ] `relayRoundTrip` field added — this is the intended change
- [ ] `relayCoordinated` semantics changed from "published" to "round-trip completed" — this is the intended change
- [ ] `scenario`, `executionResult`, `signals`, `identityPreserved`, `request` fields preserved

### 5.3 Proof scenarios unchanged

- [ ] all four scenario types still defined: `completed-no-tools`, `completed-with-tools`, `negotiation-rejected`, `negotiation-degraded`
- [ ] scenario message, tools, and requirements shapes unchanged
- [ ] each scenario exercises the same adapter negotiation/execution path

---

## 6. Relay transport — expanded, not broken

### 6.1 Existing `publish` behavior preserved

- [ ] `ProofRelayTransport.publish()` still works with the same input shape
- [ ] `publish()` return shape still includes `eventId` and `targets`

### 6.2 New methods are additive

- [ ] `registerAgent()` is a new method — no existing method signature changed
- [ ] `subscribe()` is a new method — no existing method signature changed
- [ ] `shutdown()` remains optional

### 6.3 `createAgentRelayProofTransport` updated safely

- [ ] the function still creates a transport backed by `RelayAdapter`
- [ ] existing `publish` behavior is preserved in the updated implementation
- [ ] new `registerAgent` and `subscribe` methods delegate to `RelayAdapter` primitives

---

## 7. Package boundaries — no leakage

### 7.1 Only proof files modified

- [ ] changes are confined to `packages/harness/src/adapter/proof/` directory
- [ ] `packages/harness/src/adapter/types.ts` not modified
- [ ] `packages/harness/src/adapter/claude-code-adapter.ts` not modified
- [ ] `packages/harness/src/adapter/index.ts` only modified for additive re-exports (if needed)
- [ ] `packages/harness/src/index.ts` not modified

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
- [ ] no new TypeScript compilation warnings in existing packages

### 8.2 Existing tests

- [ ] all pre-existing adapter unit tests pass without modification
- [ ] all pre-existing package tests outside the proof directory pass without modification

### 8.3 New and updated tests

- [ ] all four proof scenarios pass through the Relay-native flow
- [ ] Relay centrality test passes (no-op Relay causes failure)
- [ ] specialist receives work from Relay channel in each scenario
- [ ] orchestrator receives verdict from Relay channel in each scenario
- [ ] connectivity signals are still emitted and queryable in each scenario
- [ ] identity preservation check still passes in each scenario

---

## 9. Verification procedure

Run in order:

```bash
# 1. Build harness
npm run build --workspace @agent-assistant/harness

# 2. Existing adapter unit tests (no regression)
npx vitest run packages/harness/src/adapter/claude-code-adapter.test.ts

# 3. Updated proof integration tests
npx vitest run packages/harness/src/adapter/proof/

# 4. Full workspace build (no regression)
npm run build

# 5. Full workspace tests (no regression)
npm test
```

All must pass. Any failure is a regression.
