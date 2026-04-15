# v1 BYOH Local Relay SDK No-Regression Checklist

**Date:** 2026-04-15
**Status:** ACTIVE
**Depends on:**
- `docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md`
- `docs/architecture/v1-execution-adapter-proof-contract.md`

---

## Purpose

This checklist defines the exact no-regression constraints for the first local BYOH proof slice. Every item must be verified before the proof is considered complete.

---

## 1. Harness runtime — no behavioral regression

### 1.1 Direct harness invocation unchanged

- [ ] `createHarness(config).runTurn(input)` still works identically without adapter involvement
- [ ] `HarnessResult` shape is unchanged
- [ ] all existing `HarnessOutcome` values (`completed`, `needs_clarification`, `awaiting_approval`, `deferred`, `failed`) still produced correctly
- [ ] all existing `HarnessStopReason` values still produced correctly
- [ ] existing harness tests pass without modification

### 1.2 Harness types unchanged

- [ ] `HarnessRuntime` interface unchanged
- [ ] `HarnessConfig` interface unchanged
- [ ] `HarnessTurnInput` interface unchanged
- [ ] `HarnessResult` interface unchanged
- [ ] `HarnessModelAdapter` interface unchanged
- [ ] `HarnessToolRegistry` interface unchanged
- [ ] `HarnessApprovalAdapter` interface unchanged
- [ ] `HarnessTraceSink` interface unchanged
- [ ] no existing type removed or narrowed

### 1.3 Harness export surface unchanged

- [ ] `packages/harness/src/index.ts` exports all existing symbols
- [ ] new adapter exports are additive only
- [ ] no import path changes for existing consumers

---

## 2. Turn-context — no assembly regression

### 2.1 Assembler output unchanged

- [ ] `TurnContextAssembler.assemble(input)` returns identical `TurnContextAssembly` for identical inputs
- [ ] `TurnContextAssembly.harnessProjection` shape is unchanged
- [ ] `harnessProjection.instructions` still maps cleanly to `HarnessInstructions`
- [ ] `harnessProjection.context` still maps cleanly to `HarnessPreparedContext`

### 2.2 Turn-context types unchanged

- [ ] `TurnContextInput` interface unchanged
- [ ] `TurnContextAssembly` interface unchanged
- [ ] `TurnIdentityInput` interface unchanged
- [ ] no existing turn-context type removed or narrowed

### 2.3 Turn-context tests pass

- [ ] existing assembler tests pass without modification

---

## 3. Traits — no identity regression

### 3.1 Traits provider unchanged

- [ ] `createTraitsProvider()` works identically
- [ ] `TraitsProvider` interface unchanged
- [ ] existing traits tests pass without modification

### 3.2 Identity floor preserved in proof

- [ ] the proving harness uses real `TraitsProvider` output, not hardcoded identity strings
- [ ] assistant identity in the `ExecutionRequest` is derived from traits, not from Claude Code CLI defaults

---

## 4. Coordination — no specialist regression

### 4.1 Coordinator unchanged

- [ ] `Coordinator.execute(plan)` works identically for non-BYOH specialist plans
- [ ] `SpecialistRegistry` interface unchanged
- [ ] `SpecialistHandler` interface unchanged
- [ ] existing coordination tests pass without modification

### 4.2 Specialist registration additive only

- [ ] the validation specialist added for the proof does not conflict with existing specialist registrations
- [ ] no existing specialist behavior modified

---

## 5. Connectivity — no signaling regression

### 5.1 Connectivity layer unchanged

- [ ] `ConnectivityLayer` interface unchanged
- [ ] `ConnectivitySignal` type unchanged
- [ ] signal emission, resolution, query, and lifecycle all work identically
- [ ] existing connectivity tests pass without modification

### 5.2 Proof connectivity usage is bounded

- [ ] new signal usage in the proof does not register new signal classes or message classes
- [ ] only existing `SignalClass` and `MessageClass` values are used

---

## 6. Sessions / Policy / Continuation — no entanglement

### 6.1 Sessions unchanged

- [ ] no modifications to `@agent-assistant/sessions` code or types
- [ ] no new session-related logic in the adapter or proof harness

### 6.2 Policy unchanged

- [ ] no modifications to `@agent-assistant/policy` code or types
- [ ] adapter does not evaluate policy rules
- [ ] adapter does not record audit events

### 6.3 Continuation unchanged

- [ ] no modifications to `@agent-assistant/continuation` code or types
- [ ] adapter does not create, persist, or resume continuations
- [ ] adapter only passes through continuation-shaped data without lifecycle ownership

---

## 7. SDK facade — no surface regression

### 7.1 Top-level SDK exports unchanged

- [ ] `@agent-assistant/sdk` re-exports all existing symbols
- [ ] new adapter types are not re-exported through the top-level SDK in v1

---

## 8. Adapter-specific constraints

### 8.1 Adapter types match spec

- [ ] `ExecutionAdapter` interface matches `docs/specs/v1-execution-adapter-spec.md` exactly
- [ ] `ExecutionRequest` interface matches spec
- [ ] `ExecutionResult` interface matches spec
- [ ] `ExecutionCapabilities` interface matches spec
- [ ] `ExecutionNegotiation` interface matches spec

### 8.2 Claude Code adapter is additive

- [ ] all adapter code lives under `packages/harness/src/adapter/`
- [ ] no existing harness source files modified (except `index.ts` for additive re-export)
- [ ] no existing test files modified

### 8.3 CLI invocation is isolated

- [ ] Claude Code CLI is invoked via `child_process.spawn` only within the adapter
- [ ] no global process state modified (no environment variable mutation outside spawn scope)
- [ ] CLI failures do not throw unhandled exceptions — they produce structured `ExecutionResult` with `status: 'failed'`

---

## 9. Build and test

### 9.1 Build

- [ ] `npm run build` succeeds with no new errors
- [ ] no new TypeScript compilation warnings in existing packages

### 9.2 Existing tests

- [ ] all pre-existing tests pass without modification
- [ ] no test files outside `packages/harness/src/adapter/` are modified

### 9.3 New tests

- [ ] adapter unit tests cover all four scenarios (A–D)
- [ ] proof integration test exercises Relay SDK coordination
- [ ] proof integration test exercises connectivity signaling
- [ ] all new tests pass

---

## 10. Verification procedure

Run in order:

```bash
# 1. Build
npm run build

# 2. Existing tests (no regression)
npm test

# 3. New adapter tests
npx vitest run packages/harness/src/adapter/

# 4. Proof integration test
npx vitest run packages/harness/src/adapter/proof/
```

All must pass. Any failure is a regression.
