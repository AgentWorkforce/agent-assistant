# v1 BYOH Local Relay SDK Implementation Boundary

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-local-relay-sdk-proof-boundary.md`
- `docs/architecture/v1-execution-adapter-boundary.md`
- `docs/architecture/v1-execution-adapter-proof-slice.md`
- `docs/specs/v1-execution-adapter-spec.md`
- `docs/architecture/v1-execution-adapter-proof-contract.md`
- `docs/architecture/agent-assistant-runtime-primitive-map.md`
- `docs/architecture/relay-communicate-and-connectivity-layer.md`

---

## 1. Purpose

Define the exact first bounded implementation slice for the local BYOH proof using Agent Relay SDK as the coordination substrate and one local external execution backend through the execution-adapter seam.

This document turns the proof boundary into concrete file locations, type contracts, and proving topology.

---

## 2. Chosen external backend

### Backend: **Claude Code CLI**

Selection rationale:
- **Stable local invocation**: `claude` CLI is locally installed and invocable via `child_process.spawn`
- **Reproducible auth/runtime behavior**: uses local Anthropic API key, no cloud credential brokerage needed
- **Easy result normalization**: outputs structured JSON via `--output-format json`, returns text/tool-use results in a predictable shape
- **Useful for Sage/NightCTO local testing**: both products already use Claude-family models; testing against Claude Code validates a real execution path
- **Deterministic validation**: exit codes, structured JSON output, and predictable error modes make test assertions concrete

### Backend identifier

```
backendId: 'claude-code'
```

### What Claude Code CLI owns in this proof

- actual bounded execution of one request through `claude` CLI invocation
- no ownership of assistant identity, Relay coordination, or product intelligence

### What Claude Code CLI does NOT own

- assistant identity or traits
- turn-context assembly
- policy decisions
- continuation lifecycle
- Relay-native coordination
- session lifecycle

---

## 3. Proving topology

### Participant A — Canonical product/runtime agent

**Role:** orchestrator and identity owner
**Implementation:** a local proving harness script that assembles turn-context, builds `ExecutionRequest`, invokes the adapter, and validates the `ExecutionResult`

**Owns:**
- Agent Assistant identity/runtime semantics (via `@agent-assistant/traits`, `@agent-assistant/turn-context`)
- `ExecutionRequest` construction from `TurnContextAssembly.harnessProjection`
- policy and continuation semantics (stub-level for this proof)
- final result interpretation and product-level decisions

### Participant B — Relay-native collaborator

**Role:** bounded research/validation specialist
**Implementation:** a local specialist registered through `@agent-assistant/coordination` that participates in the proving workflow via Relay SDK channels

**Owns:**
- bounded helper work (e.g., validating execution results, summarizing outputs)
- connectivity-assisted coordination signals (handoff.ready, confidence signals)
- collaboration through Relay SDK message passing

**Does NOT own:**
- direct interaction with Claude Code CLI
- assistant identity

### Participant C — Claude Code execution plane

**Role:** external execution backend
**Implementation:** `ClaudeCodeExecutionAdapter` implementing `ExecutionAdapter` from the v1 spec

**Owns:**
- actual CLI invocation of `claude` process
- translation of `ExecutionRequest` into CLI arguments
- normalization of CLI output into `ExecutionResult`
- truthful capability description and degradation

**Does NOT own:**
- product identity
- Relay coordination
- policy or continuation lifecycle

---

## 4. Agent Relay SDK usage

The proving environment uses Agent Relay SDK as the coordination substrate:

### 4.1 Local broker/workspace/channel setup

The proof workflow uses Agent Relay SDK to:
- create a local workspace for the proving session
- establish a channel (`byoh-local-proof`) for agent communication
- register Participant A and Participant B as agents on the Relay

### 4.2 Multi-agent coordination

The Relay SDK workflow coordinates:
1. Participant A assembles turn-context and builds the `ExecutionRequest`
2. Participant A sends the request through the `ClaudeCodeExecutionAdapter`
3. The adapter invokes Claude Code CLI and returns `ExecutionResult`
4. Participant A posts the result to the Relay channel
5. Participant B (specialist) receives the result and performs bounded validation
6. Participant B emits connectivity signals (confidence, handoff) back to Participant A
7. Participant A synthesizes the final proof outcome

### 4.3 Connectivity signals

The proof exercises connectivity for:
- `confidence.high` / `confidence.low` — Participant B signals confidence in execution result quality
- `handoff.ready` — Participant B signals that validation is complete and control returns to Participant A
- `escalation.uncertainty` — Participant B signals if the execution result is ambiguous or degraded

---

## 5. Exact implementation files

### 5.1 New files to create

#### Execution adapter for Claude Code

```
packages/harness/src/adapter/claude-code-adapter.ts
```
- implements `ExecutionAdapter` interface (`backendId: 'claude-code'`)
- `describeCapabilities()` — reports Claude Code CLI capabilities
- `negotiate(request)` — evaluates request against capabilities
- `execute(request)` — spawns `claude` CLI, translates request, normalizes result

```
packages/harness/src/adapter/claude-code-adapter.test.ts
```
- unit tests for all four proving scenarios (A–D from proof slice)
- uses mock/stub CLI process for deterministic testing

```
packages/harness/src/adapter/types.ts
```
- `ExecutionAdapter`, `ExecutionRequest`, `ExecutionResult`, `ExecutionCapabilities`, `ExecutionNegotiation`, `ExecutionRequirements`, `ExecutionTrace` types
- mirrors the v1 execution adapter spec exactly
- shared by both the internal harness adapter and the Claude Code adapter

```
packages/harness/src/adapter/index.ts
```
- barrel re-export of adapter types and implementations

#### Local proving harness

```
packages/harness/src/adapter/proof/byoh-local-proof.ts
```
- the main proving harness script
- uses Agent Relay SDK for workspace/channel/agent setup
- uses `@agent-assistant/turn-context` assembler for real turn-context output
- uses `@agent-assistant/coordination` for specialist registration
- uses `@agent-assistant/connectivity` for signals
- constructs `ExecutionRequest` from `TurnContextAssembly.harnessProjection`
- invokes `ClaudeCodeExecutionAdapter`
- posts results to Relay channel
- exercises all four scenarios

```
packages/harness/src/adapter/proof/byoh-local-proof.test.ts
```
- integration test that runs the full proving flow with mocked Claude Code CLI
- validates Relay-native coordination is exercised
- validates connectivity signals are emitted
- validates execution adapter contract is honored

```
packages/harness/src/adapter/proof/validation-specialist.ts
```
- Participant B implementation
- registered as a specialist in `@agent-assistant/coordination`
- receives execution results through Relay channel
- emits connectivity signals based on result quality
- returns bounded validation output

### 5.2 Files to modify

```
packages/harness/src/index.ts
```
- add re-export of `./adapter/index.js`

```
packages/harness/package.json
```
- no new external dependencies required for v1 (uses Node.js `child_process` for CLI invocation)
- may need `@agent-relay/sdk` as a devDependency for the proof harness

---

## 6. Capability description for Claude Code CLI

```ts
const CLAUDE_CODE_CAPABILITIES: ExecutionCapabilities = {
  toolUse: 'native-iterative',        // Claude Code supports iterative tool use
  structuredToolCalls: true,           // Claude Code outputs structured tool calls in JSON mode
  continuationSupport: 'none',         // Claude Code CLI does not support mid-execution resume
  approvalInterrupts: 'none',          // Claude Code CLI does not pause for approval in non-interactive mode
  traceDepth: 'minimal',              // CLI output provides outcome but not step-level trace events
  attachments: false,                  // CLI does not support attachment pass-through
  maxContextStrategy: 'large',         // Claude models support large context
  notes: [
    'Claude Code CLI runs in non-interactive mode via --print flag',
    'Tool use is supported when the CLI session has tool access configured',
    'No mid-execution approval or continuation support in CLI mode',
  ],
};
```

### Negotiation behavior

| Requirement | Negotiation result |
| --- | --- |
| `toolUse: 'required'` | `supported: true` |
| `toolUse: 'forbidden'` | `supported: true` (tools omitted from invocation) |
| `continuationSupport: 'required'` | `supported: false`, reason: `continuation_unsupported` |
| `continuationSupport: 'preferred'` | `supported: true, degraded: true`, reason: `continuation_unsupported` |
| `approvalInterrupts: 'required'` | `supported: false`, reason: `approval_interrupt_unsupported` |
| `approvalInterrupts: 'preferred'` | `supported: true, degraded: true`, reason: `approval_interrupt_unsupported` |
| `traceDepth: 'detailed'` | `supported: true, degraded: true`, reason: `trace_depth_reduced` |
| `attachments: 'required'` | `supported: false`, reason: `attachments_unsupported` |

---

## 7. Execution translation contract

### Request → CLI invocation

| `ExecutionRequest` field | CLI translation |
| --- | --- |
| `message.text` | passed as the prompt argument to `claude --print` |
| `instructions.systemPrompt` | passed via `--system-prompt` flag |
| `instructions.developerPrompt` | prepended to the prompt text |
| `context.blocks` | serialized into a structured context prefix in the prompt |
| `tools` | tool descriptors passed via `--allowedTools` when available |
| `continuation` | ignored (capability: `none`) — negotiation rejects `required` |
| `metadata` | not passed to CLI; preserved in adapter-side trace |

### CLI output → `ExecutionResult`

| CLI output field | `ExecutionResult` mapping |
| --- | --- |
| exit code 0 + JSON output | `status: 'completed'`, `output.text` from response content |
| exit code 0 + structured tool use | `status: 'completed'`, tool results in `output.structured` |
| exit code non-zero | `status: 'failed'`, error details in `error` |
| timeout | `status: 'failed'`, `error.code: 'timeout'` |
| empty/malformed output | `status: 'failed'`, `error.code: 'invalid_backend_output'` |

---

## 8. Required proving scenarios

### Scenario A — completed, no tools

- Turn-context assembled with real `TurnContextAssembler`
- `ExecutionRequest` built with no tools
- Claude Code CLI returns a text answer
- `ExecutionResult.status === 'completed'`
- Result posted to Relay channel; validation specialist confirms via connectivity signal

### Scenario B — completed, tool-bearing turn

- `ExecutionRequest` includes tool descriptors
- Claude Code CLI exercises tool use
- `ExecutionResult.status === 'completed'` with tool results in output
- Specialist validates tool output through Relay coordination

### Scenario C — degraded negotiation (continuation required)

- `ExecutionRequest` with `requirements.continuationSupport: 'required'`
- `negotiate()` returns `supported: false`
- Proof documents truthful rejection
- No CLI invocation occurs

### Scenario D — degraded negotiation (approval preferred)

- `ExecutionRequest` with `requirements.approvalInterrupts: 'preferred'`
- `negotiate()` returns `supported: true, degraded: true`
- Execution proceeds with degradation noted
- `ExecutionResult.degradation` includes `approval_interrupt_unsupported`

---

## 9. Relay-native collaboration proof requirements

The proof must demonstrate all of the following:

1. **Relay SDK is the coordination substrate**: the proving workflow uses Agent Relay SDK for workspace/channel setup and agent coordination, not direct function calls between participants
2. **Specialist participates through Relay**: Participant B receives work and returns results through Relay channels, not through direct adapter invocation
3. **Connectivity signals are used**: at least one handoff signal and one confidence signal are emitted during the proof
4. **Product identity stays canonical**: turn-context assembly uses real `@agent-assistant/traits` and `@agent-assistant/turn-context`, not ad-hoc prompt construction
5. **External backend does not absorb coordination**: Claude Code CLI is invoked only through the adapter seam; it does not participate in Relay messaging or specialist coordination

---

## 10. What stays out of scope

### 10.1 Other external backends
No Codex CLI, no OpenAI, no other provider adapters.

### 10.2 Cloud credential brokerage
Claude Code CLI uses a local API key. No credential exchange, rotation, or cloud-mediated auth.

### 10.3 Continuation runtime integration
The proof validates that continuation-required requests are correctly rejected by negotiation. It does not integrate with continuation persistence or resume lifecycle.

### 10.4 Policy engine integration
The proof does not invoke `@agent-assistant/policy` for risk classification or approval decisions. Approval scenarios are tested through negotiation degradation, not runtime policy.

### 10.5 Multi-backend routing
No runtime selection logic across multiple backends. The proof hardcodes `claude-code` as the backend.

### 10.6 Production workflow integration
This is a local proving harness, not a production Sage/NightCTO integration path. It validates the seam works locally; product integration is a follow-up.

---

## 11. Sage/NightCTO local testing utility

While not a production integration, the proof is structured to be directly useful for local Sage/NightCTO testing:

- **Sage**: can exercise the proof harness with Sage-shaped turn-context (Sage traits, Sage system prompt) to validate that Claude Code execution preserves Sage identity
- **NightCTO**: can exercise the proof harness with NightCTO-shaped turn-context to validate the same for NightCTO identity
- **Both**: the Relay SDK coordination topology mirrors real multi-agent setups both products will use

The proving harness accepts configurable identity/traits input so either product can supply its own context without modifying the proof infrastructure.

---

## 12. Success criteria

The implementation boundary is satisfied when:

1. `ClaudeCodeExecutionAdapter` implements the `ExecutionAdapter` interface from the v1 spec
2. all four proving scenarios (A–D) pass with deterministic test assertions
3. the Relay SDK–driven proving workflow exercises real workspace/channel/agent coordination
4. connectivity signals are emitted and consumed during the proof
5. turn-context is assembled from real `@agent-assistant/turn-context` output, not ad-hoc
6. the proof runs locally without cloud dependencies beyond a local Claude API key
7. no regression to existing harness behavior (direct `HarnessRuntime.runTurn()` still works unchanged)

---

V1_BYOH_LOCAL_RELAY_SDK_IMPLEMENTATION_BOUNDARY_READY
