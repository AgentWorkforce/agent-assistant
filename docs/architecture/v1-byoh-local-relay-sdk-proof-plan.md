# v1 BYOH Local Relay SDK Proof Plan

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md`
- `docs/architecture/v1-byoh-local-relay-sdk-no-regression-checklist.md`
- `docs/specs/v1-execution-adapter-spec.md`
- `docs/architecture/v1-execution-adapter-proof-contract.md`

---

## 1. Implementation order

The proof is implemented in five sequential phases. Each phase has a clear completion gate before the next phase begins.

---

## Phase 1: Adapter types and contract

### Goal
Establish the canonical execution adapter types in the harness package, matching the v1 execution adapter spec exactly.

### Files to create

**`packages/harness/src/adapter/types.ts`**

Define the following interfaces from `docs/specs/v1-execution-adapter-spec.md`:

```ts
export interface ExecutionAdapter {
  readonly backendId: string;
  describeCapabilities(): ExecutionCapabilities;
  negotiate(request: ExecutionRequest): ExecutionNegotiation;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export interface ExecutionRequest { /* per spec §3.2 */ }
export interface ExecutionToolDescriptor { /* per spec §3.3 */ }
export interface ExecutionRequirements { /* per spec §3.4 */ }
export interface ExecutionCapabilities { /* per spec §3.5 */ }
export interface ExecutionNegotiation { /* per spec §3.6 */ }
export interface ExecutionNegotiationReason { /* per spec §3.6 */ }
export interface ExecutionResult { /* per spec §3.7 */ }
export interface ExecutionTrace { /* per spec §3.8 */ }
export interface ExecutionTraceEvent { /* per spec §3.8 */ }
```

**`packages/harness/src/adapter/index.ts`**

Barrel re-export of all types and future adapter implementations.

### Completion gate
- types compile
- no existing tests broken
- types match spec exactly

---

## Phase 2: Claude Code execution adapter

### Goal
Implement `ClaudeCodeExecutionAdapter` that translates `ExecutionRequest` into Claude Code CLI invocation and normalizes output into `ExecutionResult`.

### Files to create

**`packages/harness/src/adapter/claude-code-adapter.ts`**

Core implementation:

```ts
export interface ClaudeCodeAdapterConfig {
  /** Path to claude CLI binary. Defaults to 'claude'. */
  cliBinary?: string;
  /** Timeout in ms for CLI invocation. Defaults to 60_000. */
  timeoutMs?: number;
  /** Working directory for CLI invocation. */
  cwd?: string;
  /** Additional environment variables for CLI process. */
  env?: Record<string, string>;
}

export function createClaudeCodeAdapter(
  config?: ClaudeCodeAdapterConfig
): ExecutionAdapter;
```

Implementation details:

1. **`describeCapabilities()`**
   - Returns static capabilities:
     - `toolUse: 'native-iterative'`
     - `structuredToolCalls: true`
     - `continuationSupport: 'none'`
     - `approvalInterrupts: 'none'`
     - `traceDepth: 'minimal'`
     - `attachments: false`
     - `maxContextStrategy: 'large'`

2. **`negotiate(request)`**
   - Compares `request.requirements` against capabilities
   - Returns `supported: false` if any `required` capability is absent
   - Returns `degraded: true` if any `preferred` capability is absent
   - Returns full `reasons` array with specific codes
   - Side-effect free

3. **`execute(request)`**
   - Builds CLI arguments:
     - `claude --print --output-format json`
     - `--system-prompt` from `request.instructions.systemPrompt`
     - prompt text from `request.message.text` with optional developer prompt prefix and context block prefix
     - `--allowedTools` from `request.tools` when present
   - Spawns CLI via `child_process.spawn`
   - Collects stdout/stderr
   - Parses JSON output
   - Maps to `ExecutionResult`:
     - exit 0 + valid JSON → `status: 'completed'`
     - exit 0 + malformed output → `status: 'failed'`, `error.code: 'invalid_backend_output'`
     - non-zero exit → `status: 'failed'`, `error.code: 'backend_execution_error'`
     - timeout → `status: 'failed'`, `error.code: 'timeout'`
   - Always sets `backendId: 'claude-code'`
   - Populates `trace.summary` with timing data

**`packages/harness/src/adapter/claude-code-adapter.test.ts`**

Unit tests using a mock CLI spawner (injectable dependency for testing):

- **Test: describeCapabilities returns spec-shaped capabilities**
- **Test: negotiate — all supported, no degradation**
- **Test: negotiate — continuation required → supported: false**
- **Test: negotiate — approval preferred → degraded: true**
- **Test: negotiate — attachments required → supported: false**
- **Test: execute — completed, no tools (Scenario A)**
  - Mock CLI returns JSON with text content
  - Assert `ExecutionResult.status === 'completed'`
  - Assert `output.text` contains response
  - Assert `backendId === 'claude-code'`
- **Test: execute — completed, tool-bearing (Scenario B)**
  - Mock CLI returns JSON with tool use results
  - Assert tools are reflected in result
- **Test: execute — CLI error → failed result**
  - Mock CLI exits non-zero
  - Assert `status === 'failed'`
  - Assert `error.code === 'backend_execution_error'`
- **Test: execute — CLI timeout → failed result**
  - Mock CLI hangs past timeout
  - Assert `status === 'failed'`
  - Assert `error.code === 'timeout'`
- **Test: execute — malformed output → failed result**
  - Mock CLI returns non-JSON
  - Assert `error.code === 'invalid_backend_output'`

### Completion gate
- all unit tests pass
- no existing tests broken
- adapter implements full `ExecutionAdapter` interface

---

## Phase 3: Validation specialist

### Goal
Implement Participant B — the Relay-native collaborator that validates execution results and emits connectivity signals.

### Files to create

**`packages/harness/src/adapter/proof/validation-specialist.ts`**

```ts
export interface ValidationSpecialistConfig {
  connectivity: ConnectivityLayer;
  threadId: string;
}

export function createValidationSpecialist(
  config: ValidationSpecialistConfig
): Specialist;
```

The specialist:
1. receives an execution result as its instruction input (JSON-serialized `ExecutionResult`)
2. validates the result shape matches the `ExecutionResult` contract
3. checks `status`, `output`, `error`, `trace`, `degradation` fields
4. emits connectivity signals:
   - `confidence.high` if result is valid and complete
   - `confidence.low` if result is degraded or has missing fields
   - `escalation.uncertainty` if result status is unexpected
   - `handoff.ready` when validation is complete
5. returns a `SpecialistResult` with validation summary

### Completion gate
- specialist implements `Specialist` interface from `@agent-assistant/coordination`
- specialist emits at least one connectivity signal per invocation
- specialist does not invoke Claude Code CLI directly

---

## Phase 4: Relay SDK–driven proving workflow

### Goal
Wire the full proving topology: Participant A (orchestrator) → Adapter → Claude Code CLI → Relay channel → Participant B (specialist) → connectivity signals → final outcome.

### Files to create

**`packages/harness/src/adapter/proof/byoh-local-proof.ts`**

Main proving harness:

```ts
export interface ByohLocalProofConfig {
  /** Turn-context assembler for real assembly. */
  assembler: TurnContextAssembler;
  /** Claude Code adapter. */
  adapter: ExecutionAdapter;
  /** Coordination setup. */
  coordinator: Coordinator;
  /** Connectivity layer for signals. */
  connectivity: ConnectivityLayer;
  /** Relay SDK workspace/channel configuration. */
  relay: {
    workspaceId: string;
    channelId: string;
  };
}

export interface ByohLocalProofResult {
  scenario: string;
  executionResult: ExecutionResult;
  validationResult: SpecialistResult;
  signals: ConnectivitySignal[];
  relayCoordinated: boolean;
  identityPreserved: boolean;
}

export async function runByohLocalProof(
  config: ByohLocalProofConfig,
  scenario: ByohProofScenario,
): Promise<ByohLocalProofResult>;
```

Proof flow for each scenario:

1. **Assemble turn-context** using real `TurnContextAssembler.assemble()` with scenario-specific input (configurable identity/traits for Sage or NightCTO testing)
2. **Build `ExecutionRequest`** from `TurnContextAssembly.harnessProjection` + scenario message + optional tools
3. **Negotiate** via `adapter.negotiate(request)` — for degraded scenarios, assert and record negotiation result
4. **Execute** via `adapter.execute(request)` — for supported scenarios only
5. **Post result to Relay channel** — the execution result is posted as a message to the configured Relay workspace/channel
6. **Coordinator dispatches validation** — Participant B receives the result through the coordination plan and validates it
7. **Participant B emits connectivity signals** — confidence, handoff, or escalation
8. **Collect proof outcome** — aggregate execution result, validation result, signals, and proof metadata

Scenario definitions:

```ts
export type ByohProofScenario =
  | { type: 'completed-no-tools'; message: string }
  | { type: 'completed-with-tools'; message: string; tools: ExecutionToolDescriptor[] }
  | { type: 'negotiation-rejected'; message: string; requirements: ExecutionRequirements }
  | { type: 'negotiation-degraded'; message: string; requirements: ExecutionRequirements };
```

**`packages/harness/src/adapter/proof/byoh-local-proof.test.ts`**

Integration tests:

- **Test: Scenario A — completed, no tools**
  - Real turn-context assembly (with test traits)
  - Mock Claude Code CLI returns text
  - Validation specialist confirms via coordination
  - Assert `confidence.high` signal emitted
  - Assert `handoff.ready` signal emitted
  - Assert `relayCoordinated: true`

- **Test: Scenario B — completed, with tools**
  - Real turn-context assembly
  - Mock CLI returns tool-bearing output
  - Validation specialist confirms
  - Assert tool results in execution output

- **Test: Scenario C — negotiation rejected (continuation required)**
  - Build request with `continuationSupport: 'required'`
  - Assert `negotiate()` returns `supported: false`
  - Assert no CLI invocation
  - Validation specialist receives negotiation-rejected scenario
  - Assert `escalation.uncertainty` signal emitted

- **Test: Scenario D — negotiation degraded (approval preferred)**
  - Build request with `approvalInterrupts: 'preferred'`
  - Assert `negotiate()` returns `supported: true, degraded: true`
  - Execute proceeds
  - Assert `ExecutionResult.degradation` includes approval reason
  - Validation specialist notes degradation
  - Assert `confidence.low` signal emitted (due to degradation)

- **Test: Relay coordination is real**
  - Assert coordinator `execute(plan)` is called with validation specialist
  - Assert connectivity signals are emitted (not faked)
  - Assert specialist receives result through coordination, not direct function call

- **Test: Identity preservation**
  - Assert `ExecutionRequest.instructions` match turn-context assembly output
  - Assert traits-derived identity is present in the request
  - Assert Claude Code CLI did not override identity

### Completion gate
- all integration tests pass
- Relay SDK coordination is exercised in every scenario
- connectivity signals are emitted in every scenario
- turn-context assembly uses real assembler with real traits

---

## Phase 5: Harness export and build verification

### Goal
Wire the adapter into the harness package export surface and verify the full build and test suite.

### Files to modify

**`packages/harness/src/index.ts`**
- Add: `export * from './adapter/index.js';`

### Verification

```bash
# Full build
npm run build

# All existing tests (no regression)
npm test

# Adapter unit tests
npx vitest run packages/harness/src/adapter/claude-code-adapter.test.ts

# Proof integration tests
npx vitest run packages/harness/src/adapter/proof/

# Verify no type regressions
npx tsc --noEmit
```

### Completion gate
- build passes
- all existing tests pass
- all new tests pass
- no type errors
- no-regression checklist fully verified

---

## 2. Dependency map

```
Phase 1: types ──────────────────┐
                                 │
Phase 2: claude-code adapter ────┤
                                 │
Phase 3: validation specialist ──┤
                                 │
Phase 4: proving workflow ───────┘ (depends on all three)
                                 │
Phase 5: export + verification ──┘ (depends on Phase 4)
```

Phases 2 and 3 can be implemented in parallel after Phase 1 is complete.

---

## 3. Test infrastructure

### Mock CLI spawner

The Claude Code adapter must accept an injectable process spawner for testing:

```ts
export type CliSpawner = (
  binary: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

The default spawner uses `child_process.spawn`. Tests inject a mock spawner that returns predefined outputs.

### Test traits and identity

Tests use a minimal but real `TraitsProvider`:

```ts
const testTraits = createTraitsProvider({
  name: 'TestAssistant',
  role: 'A test assistant for BYOH proof validation',
  personality: { tone: 'helpful', directness: 'high' },
});
```

This ensures the proof validates real identity flow without depending on Sage/NightCTO-specific trait definitions.

### Test connectivity layer

Tests use a real `ConnectivityLayer` instance (in-memory) to validate signal emission. Signals are queried after each scenario to verify expected emissions.

### Test coordinator

Tests use a real `Coordinator` with the validation specialist registered. The coordinator's `execute()` path must exercise the specialist through the coordination API, not through a direct call.

---

## 4. Risk assessment

### Risk 1: Claude Code CLI output format instability
**Mitigation:** the adapter normalizes all CLI output; tests use a mock spawner. The adapter handles malformed output as `invalid_backend_output` rather than crashing.

### Risk 2: Agent Relay SDK local setup complexity
**Mitigation:** the proof uses the simplest possible Relay SDK setup — one workspace, one channel, two agents. No remote broker, no auth complexity.

### Risk 3: Scope creep into continuation/policy integration
**Mitigation:** the no-regression checklist explicitly forbids modifications to continuation, policy, and sessions packages. Negotiation-rejected scenarios prove the boundary without integration.

### Risk 4: Adapter becomes a second harness
**Mitigation:** the adapter delegates to CLI execution only. It does not implement a model-tool loop, transcript accumulation, or iteration control. Those remain in `@agent-assistant/harness`.

---

## 5. What this proof will demonstrate when complete

1. The execution-adapter seam is real and operational for an external backend
2. Claude Code CLI can participate as an execution plane without absorbing product identity
3. Agent Relay SDK coordinates the proving topology — it is not just a test framework
4. Connectivity provides useful signals during multi-agent validation
5. Turn-context assembly and traits remain canonical — the adapter consumes assembled output, it does not replace assembly
6. Negotiation and degradation work truthfully — unsupported capabilities are rejected, not faked
7. The harness package can host adapter code additively without regressing existing behavior

---

## 6. Next continuation point

After this proof is implemented and reviewed, the recommended next slices are:

1. **Internal harness adapter** — implement the `agent-assistant-harness` adapter that wraps `HarnessRuntime.runTurn()` through the same `ExecutionAdapter` contract, proving the seam works for both internal and external backends
2. **Sage/NightCTO local integration test** — use real Sage/NightCTO traits and system prompts with the proof harness to validate product-specific identity preservation
3. **Second external backend** — add a Codex CLI adapter to validate the contract generalizes beyond one provider
