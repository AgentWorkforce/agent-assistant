# v1 BYOH Relay-Native Follow-up Boundary

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md`
- `docs/architecture/v1-byoh-local-relay-sdk-review-verdict.md`
- `docs/architecture/v1-byoh-local-relay-sdk-proof-boundary.md`

---

## 1. Purpose

Convert the BYOH local proof from "Relay-adjacent" to "Relay-native." The first slice proved the execution-adapter seam and local Claude Code execution. This follow-up slice makes Agent Relay SDK the structurally mandatory coordination substrate for the proving workflow.

After this slice, removing Relay transport from the proof must cause a test failure — Relay is load-bearing, not decorative.

---

## 2. Problem statement from review verdict

The review verdict (PARTIAL_ACCEPT) identified three structural gaps:

1. **Relay is optional.** `config.relay` and `config.relayConfig` are optional in `ByohLocalProofConfig`. The proof completes without Relay transport at all (`byoh-local-proof.ts:303`).
2. **Specialist invocation is direct, not Relay-mediated.** The validation specialist is invoked through `coordinator.execute(...)` (`byoh-local-proof.ts:338`), not through Relay channel traffic.
3. **`relayCoordinated` is cosmetic.** It means "a Relay message was published" rather than "coordination occurred through Relay" (`byoh-local-proof.ts:359`).

---

## 3. Architectural decision

This slice refactors the proving workflow so that:

> **The validation specialist receives its work from Relay channel traffic and returns its verdict through Relay channel traffic. The orchestrator and specialist are registered Relay participants. Removing Relay breaks the proof.**

This slice does NOT:
- replace `@agent-assistant/coordination` or `@agent-assistant/connectivity`
- add new external backends
- change the execution-adapter seam or Claude Code adapter
- modify any package outside `packages/harness/src/adapter/proof/`

---

## 4. Revised proving topology

### Participant A — Orchestrator (unchanged role, revised coordination path)

**Role:** canonical product/runtime agent
**Relay registration:** registered as agent `orchestrator` on the proof channel

**Coordination flow (revised):**
1. Assembles turn-context and builds `ExecutionRequest` (unchanged)
2. Invokes `ClaudeCodeExecutionAdapter.execute()` (unchanged)
3. **Publishes execution result to Relay channel** as a structured message with `type: 'execution-result'`
4. **Subscribes to Relay channel for specialist response** with `type: 'validation-verdict'`
5. Receives specialist verdict from Relay channel
6. Synthesizes final proof outcome using the Relay-delivered verdict

### Participant B — Validation specialist (revised coordination path)

**Role:** bounded research/validation specialist
**Relay registration:** registered as agent `validation-specialist` on the proof channel

**Coordination flow (revised):**
1. **Subscribes to Relay channel** for messages with `type: 'execution-result'`
2. Receives execution result from Relay channel (not from direct `coordinator.execute()` instruction)
3. Validates result shape and status (unchanged logic from existing `validation-specialist.ts`)
4. Emits connectivity signals locally (connectivity is a helper, not the coordination path)
5. **Publishes validation verdict to Relay channel** as a structured message with `type: 'validation-verdict'`

### Participant C — Claude Code execution plane (unchanged)

No changes. The adapter remains invoked directly by Participant A through the execution-adapter seam. It does not participate in Relay messaging.

---

## 5. Relay participation contract

### 5.1 Channel structure

The proof uses a single Relay channel (`byoh-local-proof`) with two registered agents.

### 5.2 Message protocol

Two message types flow through the Relay channel:

#### `execution-result` (orchestrator → specialist)

```ts
interface RelayExecutionResultMessage {
  type: 'execution-result';
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  turnId: string;
  threadId: string;
}
```

#### `validation-verdict` (specialist → orchestrator)

```ts
interface RelayValidationVerdictMessage {
  type: 'validation-verdict';
  verdict: {
    output: string;
    confidence: number;
    status: 'complete' | 'partial' | 'failed';
    validatedStatus: string;
    degraded: boolean;
  };
  signals: Array<{
    signalClass: string;
    summary: string;
  }>;
  turnId: string;
  threadId: string;
}
```

### 5.3 Agent registration

Both participants register as Relay agents before the proof flow begins:

```ts
await relay.registerAgent({
  agentId: 'orchestrator',
  channel: channelId,
  capabilities: ['execution-request', 'proof-synthesis'],
});

await relay.registerAgent({
  agentId: 'validation-specialist',
  channel: channelId,
  capabilities: ['execution-validation', 'proof-signals'],
});
```

### 5.4 Message subscription

The specialist subscribes to the channel and filters for `type: 'execution-result'` messages. The orchestrator subscribes and filters for `type: 'validation-verdict'` messages.

---

## 6. Revised `ByohLocalProofConfig`

```ts
export interface ByohLocalProofConfig {
  assembler: ProofTurnContextAssembler;
  adapter: ExecutionAdapter;
  relay: ProofRelayTransport;          // REQUIRED, no longer optional
  relayConfig: {                        // REQUIRED, no longer optional
    channelId: string;
    workspaceId?: string;
    cwd?: string;
  };
  connectivity?: ConnectivityLayer;     // optional helper, not primary coordination
  traitsProvider?: TraitsProvider;
}
```

Key change: `relay` and `relayConfig` are **required**. The `coordinator` field is **removed** from the config — coordination happens through Relay, not through the local coordinator's `execute()` path.

The local coordinator and specialist registry are still used internally for connectivity signal collection, but they are **observers** of the Relay-mediated flow, not the primary execution path.

---

## 7. Revised `ProofRelayTransport` interface

The existing `ProofRelayTransport` only supports `publish`. The follow-up requires `registerAgent`, `subscribe`, and `waitForMessage`:

```ts
export interface ProofRelayTransport {
  registerAgent(input: {
    agentId: string;
    channel: string;
    capabilities: string[];
  }): Promise<void>;

  publish(input: {
    channel: string;
    text: string;
    threadId: string;
    from?: string;
  }): Promise<{ eventId?: string; targets?: string[] }>;

  subscribe(input: {
    channel: string;
    agentId: string;
    filter?: (message: RelayChannelMessage) => boolean;
  }): RelaySubscription;

  shutdown?(): Promise<void>;
}

export interface RelaySubscription {
  waitForMessage(timeoutMs?: number): Promise<RelayChannelMessage>;
  unsubscribe(): void;
}

export interface RelayChannelMessage {
  eventId: string;
  from: string;
  channel: string;
  threadId: string;
  text: string;
  receivedAt: string;
}
```

---

## 8. Revised proof flow

```
Orchestrator                     Relay Channel                  Specialist
    │                                │                              │
    │── registerAgent('orchestrator')│                              │
    │                                │── registerAgent('specialist')│
    │                                │                              │
    │── assemble turn-context        │                              │
    │── adapter.execute(request)     │                              │
    │                                │                              │
    │── publish(execution-result) ──►│                              │
    │                                │──── deliver ────────────────►│
    │                                │                              │── validate result
    │                                │                              │── emit connectivity signals
    │                                │◄── publish(validation-verdict)│
    │◄── waitForMessage('verdict')   │                              │
    │                                │                              │
    │── synthesize final outcome     │                              │
```

### Critical path through Relay

The specialist **cannot** validate the execution result without receiving it from the Relay channel. The orchestrator **cannot** synthesize the final outcome without receiving the validation verdict from the Relay channel. Removing Relay breaks both paths.

---

## 9. Connectivity as helper, not primary path

Connectivity signals remain in the specialist. They serve as:
- observable audit trail for the coordination flow
- structured metadata that the orchestrator can query after receiving the Relay verdict
- existing contract preservation (no regression on signal emission)

Connectivity does NOT:
- carry the execution result to the specialist
- carry the validation verdict to the orchestrator
- replace Relay channel traffic for coordination

The orchestrator may still query `connectivity.query()` after the proof to inspect emitted signals for test assertions, but the functional coordination path is Relay-native.

---

## 10. Exact implementation files

### 10.1 Files to modify

#### `packages/harness/src/adapter/proof/byoh-local-proof.ts`

Changes:
1. Make `relay` and `relayConfig` required in `ByohLocalProofConfig`
2. Remove `coordinator` from `ByohLocalProofConfig`
3. Expand `ProofRelayTransport` with `registerAgent`, `subscribe`, `waitForMessage`
4. Add `RelaySubscription`, `RelayChannelMessage`, `RelayExecutionResultMessage`, `RelayValidationVerdictMessage` types
5. Revise `runByohLocalProof` flow:
   - Register orchestrator and specialist as Relay agents
   - Specialist subscribes to channel for `execution-result` messages
   - Orchestrator publishes execution result to channel
   - Specialist receives result from Relay, validates, publishes verdict to channel
   - Orchestrator receives verdict from Relay
   - Final outcome assembled from Relay-delivered verdict
6. Update `ByohLocalProofResult`:
   - `relayCoordinated` is true only when both publish AND receive occurred through Relay
   - Add `relayRoundTrip: { resultPublished: boolean; verdictReceived: boolean }` field
7. Update `createAgentRelayProofTransport` to implement expanded `ProofRelayTransport`

#### `packages/harness/src/adapter/proof/validation-specialist.ts`

Changes:
1. Add a Relay-native entry point alongside the existing `Specialist` handler:

```ts
export function createRelayValidationHandler(config: {
  connectivity: ConnectivityLayer;
  relay: ProofRelayTransport;
  channelId: string;
  threadId: string;
}): RelayValidationHandler;
```

2. The Relay handler:
   - Subscribes to the channel for `execution-result` messages
   - On receipt, runs the same validation logic as the existing specialist handler
   - Emits connectivity signals (unchanged)
   - Publishes `validation-verdict` to the Relay channel
3. The existing `Specialist` interface implementation is preserved but is no longer the primary path in the proof

#### `packages/harness/src/adapter/proof/byoh-local-proof.test.ts`

Changes:
1. Update existing tests to use required `relay` and `relayConfig`
2. Add **Relay centrality test** (section 11 below)
3. Remove any tests that exercise the `coordinator` config path for specialist invocation
4. Add tests that verify:
   - Specialist receives work from Relay, not from direct invocation
   - Orchestrator receives verdict from Relay, not from coordinator return value
   - `relayRoundTrip` field accurately reflects both legs of the Relay exchange

### 10.2 Files NOT modified

- `packages/harness/src/adapter/types.ts` — no changes to execution adapter types
- `packages/harness/src/adapter/claude-code-adapter.ts` — no changes to CLI adapter
- `packages/harness/src/adapter/claude-code-adapter.test.ts` — no changes to adapter unit tests
- `packages/harness/src/adapter/index.ts` — may need to re-export new types, but no structural change
- `packages/harness/src/index.ts` — no change
- All packages outside `packages/harness/src/adapter/proof/` — no changes

---

## 11. Relay centrality proof test

The proof must include one integration test that structurally fails when Relay is removed:

```ts
test('proof fails when Relay transport is replaced with a no-op', async () => {
  const noopRelay: ProofRelayTransport = {
    async registerAgent() {},
    async publish() { return {}; },
    subscribe() {
      return {
        waitForMessage() {
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error('No Relay message received')), 500)
          );
        },
        unsubscribe() {},
      };
    },
    async shutdown() {},
  };

  await expect(
    runByohLocalProof(
      { ...validConfig, relay: noopRelay },
      scenario,
    ),
  ).rejects.toThrow(/No Relay message received|timeout/i);
});
```

This test proves Relay is structurally central: the specialist never receives work, so it never publishes a verdict, so the orchestrator times out waiting for the verdict. The proof cannot complete without functional Relay transport.

---

## 12. Revised `ByohLocalProofResult`

```ts
export interface ByohLocalProofResult {
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  validationVerdict: {
    output: string;
    confidence: number;
    status: 'complete' | 'partial' | 'failed';
    validatedStatus: string;
    degraded: boolean;
  };
  signals: ConnectivitySignal[];
  relayCoordinated: boolean;
  relayRoundTrip: {
    resultPublished: boolean;
    resultEventId?: string;
    verdictReceived: boolean;
    verdictEventId?: string;
  };
  identityPreserved: boolean;
  request: ExecutionRequest;
}
```

Key changes:
- `validationResult: SpecialistResult` replaced by `validationVerdict` — the verdict shape received from Relay, not a local coordinator return type
- `relayRoundTrip` added — proves both legs of the Relay exchange occurred
- `relayCoordinated` is now `resultPublished && verdictReceived`, not just "a message was published"

---

## 13. What stays out of scope

### 13.1 No new external backends
This slice only modifies the proof coordination path. The Claude Code adapter is unchanged.

### 13.2 No Relay broker infrastructure changes
The proof uses the same local Relay broker setup. No new workspace types, channel configurations, or agent lifecycle management beyond registration.

### 13.3 No changes to coordination or connectivity packages
`@agent-assistant/coordination` and `@agent-assistant/connectivity` are consumed unchanged. The specialist's internal validation logic is reused. Only the entry point changes from coordinator-driven to Relay-driven.

### 13.4 No changes to turn-context, traits, policy, sessions, continuation
All upstream packages are unchanged. The proof still consumes real `TraitsProvider` and `ProofTurnContextAssembler` output.

### 13.5 No `ProofTurnContextAssembler` replacement
The review verdict noted the local assembler replica (Finding 2). That is a separate concern and is not addressed in this slice. The assembler contract drift is low-severity and can be addressed in a subsequent slice that imports the canonical type directly.

---

## 14. Success criteria

This follow-up slice is successful when all of the following are true:

1. `relay` and `relayConfig` are required in `ByohLocalProofConfig` — the proof cannot be invoked without Relay transport
2. The validation specialist receives its work from the Relay channel, not from `coordinator.execute()`
3. The validation specialist publishes its verdict to the Relay channel, not as a `SpecialistResult` return value
4. The orchestrator receives the verdict from the Relay channel, not from the coordinator's return value
5. The Relay centrality test (section 11) passes — replacing Relay with a no-op causes a timeout/failure
6. Connectivity signals are still emitted by the specialist (no regression on signal emission)
7. All four proving scenarios (A–D) still work through the revised Relay-native flow
8. No packages outside `packages/harness/src/adapter/proof/` are modified
9. Existing adapter unit tests (`claude-code-adapter.test.ts`) pass without modification
