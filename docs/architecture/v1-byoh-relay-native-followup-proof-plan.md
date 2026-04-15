# v1 BYOH Relay-Native Follow-up Proof Plan

**Date:** 2026-04-15
**Status:** IMPLEMENTATION_READY
**Depends on:**
- `docs/architecture/v1-byoh-relay-native-followup-boundary.md`
- `docs/architecture/v1-byoh-relay-native-followup-no-regression-checklist.md`
- `docs/architecture/v1-byoh-local-relay-sdk-implementation-boundary.md`

---

## 1. Implementation order

The follow-up is implemented in four sequential phases. Each phase has a clear completion gate.

---

## Phase 1: Expand `ProofRelayTransport` contract

### Goal
Extend the Relay transport interface to support agent registration, subscription, and message waiting — the primitives required for Relay-native coordination.

### Files to modify

**`packages/harness/src/adapter/proof/byoh-local-proof.ts`**

Add or update the following types:

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

Add Relay message envelope types:

```ts
export interface RelayExecutionResultMessage {
  type: 'execution-result';
  scenario: ByohProofScenario['type'];
  executionResult: ExecutionResult;
  turnId: string;
  threadId: string;
}

export interface RelayValidationVerdictMessage {
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

Update `createAgentRelayProofTransport` to implement the expanded interface using `RelayAdapter` primitives:
- `registerAgent` → `relay.registerAgent()` or equivalent SDK method
- `subscribe` → `relay.subscribe()` with filter support, returning a `RelaySubscription` that wraps the SDK's message iterator
- `publish` → existing implementation (unchanged)

### Completion gate
- expanded `ProofRelayTransport` compiles
- `createAgentRelayProofTransport` implements all new methods
- existing `publish` behavior unchanged

---

## Phase 2: Add Relay-native validation handler

### Goal
Create a Relay-native entry point for the validation specialist that receives work from a Relay channel and publishes its verdict to the same channel.

### Files to modify

**`packages/harness/src/adapter/proof/validation-specialist.ts`**

Add a new export alongside the existing `createValidationSpecialist`:

```ts
export interface RelayValidationHandler {
  start(): Promise<void>;
  stop(): void;
}

export function createRelayValidationHandler(config: {
  connectivity: ConnectivityLayer;
  relay: ProofRelayTransport;
  channelId: string;
  threadId: string;
  specialistName?: string;
  timeoutMs?: number;
}): RelayValidationHandler;
```

Implementation:

1. `start()`:
   - Calls `relay.registerAgent({ agentId: specialistName, channel: channelId, capabilities: ['execution-validation', 'proof-signals'] })`
   - Calls `relay.subscribe({ channel: channelId, agentId: specialistName, filter: msg => JSON.parse(msg.text).type === 'execution-result' })`
   - Awaits `subscription.waitForMessage(timeoutMs)` to receive the execution result
   - Parses the `RelayExecutionResultMessage` from the received message
   - Runs the **same** `parseExecutionResult` → `summarize` → emit connectivity signals logic that exists today
   - Constructs a `RelayValidationVerdictMessage` from the validation output
   - Calls `relay.publish({ channel: channelId, from: specialistName, threadId, text: JSON.stringify(verdictMessage) })`

2. `stop()`:
   - Unsubscribes from the channel

Key constraint: the validation logic (parse, summarize, signal emission) is **factored out** of the existing `handler.execute()` into a shared internal function. Both the `Specialist` handler and the `RelayValidationHandler` call the same internal function. This prevents logic duplication and ensures behavioral parity.

```ts
// Internal shared function (not exported)
function validateExecutionResult(
  instruction: string,
  config: { connectivity: ConnectivityLayer; threadId: string; specialistName: string },
): {
  output: string;
  confidence: number;
  status: 'complete' | 'partial' | 'failed';
  validatedStatus: string;
  degraded: boolean;
  signals: Array<{ signalClass: string; summary: string }>;
}
```

The existing `createValidationSpecialist` is preserved and updated to call this shared function internally. Its external interface and behavior are unchanged.

### Completion gate
- `createRelayValidationHandler` compiles
- existing `createValidationSpecialist` still works identically
- shared validation logic factored without behavioral change
- handler subscribes to Relay, receives message, publishes verdict

---

## Phase 3: Refactor `runByohLocalProof` to Relay-native flow

### Goal
Make the proof orchestration flow Relay-native: the orchestrator publishes execution results to Relay, the specialist receives from Relay, validates, publishes verdict to Relay, and the orchestrator receives the verdict from Relay.

### Files to modify

**`packages/harness/src/adapter/proof/byoh-local-proof.ts`**

Update `ByohLocalProofConfig`:

```ts
export interface ByohLocalProofConfig {
  assembler: ProofTurnContextAssembler;
  adapter: ExecutionAdapter;
  relay: ProofRelayTransport;           // required
  relayConfig: {                         // required
    channelId: string;
    workspaceId?: string;
    cwd?: string;
  };
  connectivity?: ConnectivityLayer;
  traitsProvider?: TraitsProvider;
  timeoutMs?: number;                    // default 30_000
}
```

Update `ByohLocalProofResult`:

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

Revised `runByohLocalProof` implementation:

```ts
export async function runByohLocalProof(
  config: ByohLocalProofConfig,
  scenario: ByohProofScenario,
): Promise<ByohLocalProofResult> {
  const traitsProvider = config.traitsProvider ?? defaultTraitsProvider();
  const connectivity = config.connectivity ?? createConnectivityLayer();
  const channelId = config.relayConfig.channelId;
  const timeoutMs = config.timeoutMs ?? 30_000;

  // 1. Build execution request (unchanged)
  const request = await buildExecutionRequest(config.assembler, traitsProvider, scenario);
  const threadId = request.threadId ?? request.turnId;

  // 2. Register orchestrator as Relay agent
  await config.relay.registerAgent({
    agentId: 'orchestrator',
    channel: channelId,
    capabilities: ['execution-request', 'proof-synthesis'],
  });

  // 3. Start specialist Relay handler (registers agent + subscribes)
  const specialistHandler = createRelayValidationHandler({
    connectivity,
    relay: config.relay,
    channelId,
    threadId,
    timeoutMs,
  });

  // 4. Start specialist listening (non-blocking — it awaits a message internally)
  const specialistDone = specialistHandler.start();

  // 5. Negotiate and execute (unchanged)
  const negotiation = config.adapter.negotiate(request);
  const executionResult = negotiation.supported
    ? await config.adapter.execute(request)
    : {
        backendId: config.adapter.backendId,
        status: 'unsupported' as const,
        error: {
          code: 'unsupported_capability' as const,
          message: negotiation.reasons.map(r => r.message).join(' '),
        },
        degradation: negotiation.reasons,
      };

  // 6. Publish execution result to Relay channel
  const resultMessage: RelayExecutionResultMessage = {
    type: 'execution-result',
    scenario: scenario.type,
    executionResult,
    turnId: request.turnId,
    threadId,
  };

  const resultPublication = await config.relay.publish({
    channel: channelId,
    threadId,
    from: 'orchestrator',
    text: JSON.stringify(resultMessage),
  });

  // 7. Subscribe for specialist verdict
  const verdictSubscription = config.relay.subscribe({
    channel: channelId,
    agentId: 'orchestrator',
    filter: (msg) => {
      try {
        const parsed = JSON.parse(msg.text);
        return parsed.type === 'validation-verdict';
      } catch {
        return false;
      }
    },
  });

  // 8. Wait for specialist to complete and verdict to arrive
  await specialistDone;
  const verdictMessage = await verdictSubscription.waitForMessage(timeoutMs);
  verdictSubscription.unsubscribe();

  // 9. Parse verdict from Relay message
  const verdictPayload = JSON.parse(verdictMessage.text) as RelayValidationVerdictMessage;

  // 10. Collect connectivity signals
  const signals = connectivity.query({ threadId });

  // 11. Cleanup
  specialistHandler.stop();
  if (config.relay.shutdown) {
    await config.relay.shutdown();
  }

  // 12. Assemble result
  return {
    scenario: scenario.type,
    executionResult,
    validationVerdict: verdictPayload.verdict,
    signals,
    relayCoordinated: true,
    relayRoundTrip: {
      resultPublished: true,
      resultEventId: resultPublication.eventId,
      verdictReceived: true,
      verdictEventId: verdictMessage.eventId,
    },
    identityPreserved: request.instructions.systemPrompt.includes('Sage'),
    request,
  };
}
```

### Completion gate
- `runByohLocalProof` compiles with the revised flow
- `relay` and `relayConfig` are required — TypeScript errors if omitted
- specialist receives work from Relay, not from coordinator
- orchestrator receives verdict from Relay, not from coordinator return
- connectivity signals are still collected

---

## Phase 4: Tests and verification

### Goal
Update existing tests and add the Relay centrality test. Verify no regressions.

### Files to modify

**`packages/harness/src/adapter/proof/byoh-local-proof.test.ts`**

#### Test infrastructure: mock Relay transport

Create a `createMockRelayTransport()` that implements `ProofRelayTransport` with in-memory message routing:

```ts
function createMockRelayTransport(): ProofRelayTransport & {
  messages: RelayChannelMessage[];
  registeredAgents: Array<{ agentId: string; channel: string }>;
} {
  const messages: RelayChannelMessage[] = [];
  const subscribers: Map<string, Array<{
    filter?: (msg: RelayChannelMessage) => boolean;
    resolve: (msg: RelayChannelMessage) => void;
  }>> = new Map();
  const registeredAgents: Array<{ agentId: string; channel: string }> = [];

  return {
    messages,
    registeredAgents,

    async registerAgent(input) {
      registeredAgents.push({ agentId: input.agentId, channel: input.channel });
    },

    async publish(input) {
      const msg: RelayChannelMessage = {
        eventId: `evt-${messages.length}`,
        from: input.from ?? 'unknown',
        channel: input.channel,
        threadId: input.threadId,
        text: input.text,
        receivedAt: new Date().toISOString(),
      };
      messages.push(msg);

      // Deliver to waiting subscribers
      const channelSubs = subscribers.get(input.channel) ?? [];
      for (const sub of channelSubs) {
        if (!sub.filter || sub.filter(msg)) {
          sub.resolve(msg);
        }
      }

      return { eventId: msg.eventId, targets: [input.channel] };
    },

    subscribe(input) {
      let unsubscribed = false;
      return {
        waitForMessage(timeoutMs = 5000) {
          return new Promise((resolve, reject) => {
            // Check existing messages first
            const existing = messages.find(
              m => m.channel === input.channel && (!input.filter || input.filter(m))
            );
            if (existing) { resolve(existing); return; }

            // Wait for future message
            const subs = subscribers.get(input.channel) ?? [];
            subs.push({ filter: input.filter, resolve });
            subscribers.set(input.channel, subs);

            setTimeout(() => {
              if (!unsubscribed) reject(new Error('Relay message timeout'));
            }, timeoutMs);
          });
        },
        unsubscribe() { unsubscribed = true; },
      };
    },

    async shutdown() {},
  };
}
```

#### Updated scenario tests

All four scenario tests are updated to use the mock Relay transport. Each test verifies:

**Test: Scenario A — completed, no tools (Relay-native)**
- Mock CLI returns text
- Assert `relayRoundTrip.resultPublished === true`
- Assert `relayRoundTrip.verdictReceived === true`
- Assert `validationVerdict.status === 'complete'`
- Assert `validationVerdict.confidence === 0.95`
- Assert signals include `confidence.high` and `handoff.ready`
- Assert mock transport has exactly 2 messages: one `execution-result`, one `validation-verdict`
- Assert registered agents include both `orchestrator` and `validation-specialist`

**Test: Scenario B — completed, with tools (Relay-native)**
- Mock CLI returns tool-bearing output
- Assert same Relay round-trip structure
- Assert tool results present in execution result
- Assert specialist validated via Relay

**Test: Scenario C — negotiation rejected (Relay-native)**
- Build request with `continuationSupport: 'required'`
- Assert `negotiate()` returns `supported: false`
- Assert execution result posted to Relay with `status: 'unsupported'`
- Assert specialist receives unsupported result from Relay
- Assert `validationVerdict.validatedStatus === 'unsupported'`
- Assert signals include `confidence.low` and `handoff.ready`

**Test: Scenario D — negotiation degraded (Relay-native)**
- Build request with `approvalInterrupts: 'preferred'`
- Assert execution proceeds with degradation
- Assert degradation noted in Relay-delivered verdict
- Assert `validationVerdict.degraded === true`

#### New: Relay centrality test

```ts
test('proof fails when Relay transport delivers no messages', async () => {
  const brokenRelay = createMockRelayTransport();
  // Override publish to silently drop messages (no delivery to subscribers)
  brokenRelay.publish = async (input) => {
    // Record but do not deliver to subscribers
    return { eventId: 'dropped', targets: [] };
  };

  await expect(
    runByohLocalProof(
      { ...validConfig, relay: brokenRelay, timeoutMs: 500 },
      completedNoToolsScenario,
    ),
  ).rejects.toThrow(/timeout/i);
});
```

This test proves that removing functional Relay message delivery breaks the proof. The specialist never receives the execution result, never publishes a verdict, and the orchestrator times out waiting.

#### New: Relay agent registration test

```ts
test('both participants are registered as Relay agents', async () => {
  const relay = createMockRelayTransport();

  await runByohLocalProof(
    { ...validConfig, relay },
    completedNoToolsScenario,
  );

  expect(relay.registeredAgents).toContainEqual(
    expect.objectContaining({ agentId: 'orchestrator' })
  );
  expect(relay.registeredAgents).toContainEqual(
    expect.objectContaining({ agentId: 'validation-specialist' })
  );
});
```

#### New: Relay message flow test

```ts
test('execution result and validation verdict flow through Relay channel', async () => {
  const relay = createMockRelayTransport();

  const result = await runByohLocalProof(
    { ...validConfig, relay },
    completedNoToolsScenario,
  );

  // Verify message types in order
  const messageTypes = relay.messages.map(m => JSON.parse(m.text).type);
  expect(messageTypes).toEqual(['execution-result', 'validation-verdict']);

  // Verify round-trip
  expect(result.relayRoundTrip.resultPublished).toBe(true);
  expect(result.relayRoundTrip.verdictReceived).toBe(true);
});
```

#### Preserved: Identity preservation test

```ts
test('product identity is preserved through Relay-native flow', async () => {
  const relay = createMockRelayTransport();

  const result = await runByohLocalProof(
    { ...validConfig, relay },
    completedNoToolsScenario,
  );

  expect(result.identityPreserved).toBe(true);
  expect(result.request.instructions.systemPrompt).toContain('Sage');
});
```

#### Preserved: Connectivity signal test

```ts
test('connectivity signals are emitted during Relay-native validation', async () => {
  const relay = createMockRelayTransport();
  const connectivity = createConnectivityLayer();

  const result = await runByohLocalProof(
    { ...validConfig, relay, connectivity },
    completedNoToolsScenario,
  );

  expect(result.signals.length).toBeGreaterThan(0);
  expect(result.signals.some(s => s.signalClass === 'handoff.ready')).toBe(true);
});
```

### Completion gate
- all four scenario tests pass with Relay-native flow
- Relay centrality test passes
- agent registration test passes
- message flow test passes
- identity preservation test passes
- connectivity signal test passes
- existing adapter unit tests pass without modification

---

## 2. Dependency map

```
Phase 1: Expand ProofRelayTransport ────────┐
                                            │
Phase 2: Relay-native validation handler ───┤
                                            │
Phase 3: Refactor runByohLocalProof ────────┘ (depends on both)
                                            │
Phase 4: Tests and verification ────────────┘ (depends on Phase 3)
```

Phases 1 and 2 can be implemented in parallel.

---

## 3. Risk assessment

### Risk 1: RelayAdapter SDK may not expose `registerAgent` or `subscribe` primitives directly
**Mitigation:** the `ProofRelayTransport` is an abstraction over whatever the SDK provides. If `RelayAdapter` does not have a `registerAgent` method, the transport implementation can use whatever SDK primitive achieves the same effect (e.g., joining a channel with agent metadata). The mock transport in tests validates the contract independent of SDK specifics.

### Risk 2: Async coordination timing between specialist subscribe and orchestrator publish
**Mitigation:** the specialist's `start()` method is called before the orchestrator publishes. The mock transport in tests delivers synchronously from `publish` to waiting subscribers. For the real `RelayAdapter`, the SDK's message delivery guarantees handle ordering. A configurable `timeoutMs` provides a safety net.

### Risk 3: Refactoring validation logic into shared function may introduce subtle behavioral differences
**Mitigation:** the shared function is a pure extract-method refactor. The existing `Specialist` handler is updated to call the shared function and return the same `SpecialistResult` shape. A unit test can verify that calling the specialist handler directly still produces identical output for the same input.

### Risk 4: Removing `coordinator` from config may break consumers that pass it
**Mitigation:** this is a proof-internal config. No external consumers depend on `ByohLocalProofConfig`. The only consumers are the proof test file and potentially a manual proof runner script. Both are updated in this slice.

---

## 4. What this follow-up will demonstrate when complete

1. **Relay is structurally central:** the proof fails without functional Relay transport — not cosmetically, but because the coordination path is broken
2. **Specialist participates through Relay:** the specialist receives execution results from Relay channel messages, not from direct function calls
3. **Orchestrator receives verdict through Relay:** the orchestrator consumes the specialist's verdict from Relay channel messages, not from a coordinator return value
4. **Both participants are registered Relay agents:** the proof channel has two registered agents that participate through Relay's agent model
5. **Connectivity is a helper, not the primary path:** signals are still emitted and queryable, but they do not carry execution results or validation verdicts between participants
6. **All four scenarios work through Relay:** negotiation, execution, and validation all flow through the Relay-native path regardless of scenario type
7. **No regressions:** adapter, connectivity, coordination, traits, and turn-context packages are all unchanged

---

## 5. Next continuation point

After this follow-up is implemented and reviewed, the recommended next slices are:

1. **Import canonical `TurnContextAssembler` type** — replace the local `ProofTurnContextAssembler` replica with a direct import from `@agent-assistant/turn-context`, addressing Finding 2 from the review verdict
2. **Internal harness adapter** — implement the `agent-assistant-harness` adapter that wraps `HarnessRuntime.runTurn()` through the same `ExecutionAdapter` contract
3. **Sage/NightCTO local integration test** — use real product traits and system prompts with the Relay-native proof harness
4. **Second external backend** — add a Codex CLI adapter to validate the contract generalizes
