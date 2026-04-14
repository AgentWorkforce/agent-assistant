# v1 Execution Adapter Spec

**Status:** IMPLEMENTATION_GUIDE / INTERNAL_CONTRACT  
**Date:** 2026-04-14  
**Purpose:** Specify the concrete v1 contract for the execution-harness adapter boundary used by Agent Assistant to support BYOH execution backends.

> This is a docs-first contract. It does **not** imply a public package yet.

---

## 1. Responsibilities

The execution adapter contract exists to let Agent Assistant invoke a concrete execution backend through a normalized interface while preserving product/runtime ownership of:
- identity
- turn-context
- policy
- continuation
- sessions
- Relay-native coordination

**Owns:**
- execution capability description
- request negotiation
- canonical-to-backend invocation translation
- backend-to-canonical result normalization
- explicit degradation / unsupported signaling
- bounded execution trace normalization

**Does NOT own:**
- turn-context assembly
- session lifecycle
- continuation lifecycle
- policy decisions
- memory retrieval
- Relay transport, auth, scheduling, files, or coordination
- product prompts/heuristics beyond what is already assembled upstream

---

## 2. Canonical execution model

The adapter runs one bounded execution request.

The caller:
1. assembles turn-context and product shaping upstream
2. evaluates any policy gates it owns
3. decides which backend to use
4. invokes the adapter
5. receives a normalized execution result
6. decides what to do next in product/runtime code

The adapter is therefore **late-bound execution glue**, not the assistant runtime.

---

## 3. Core types

## 3.1 `ExecutionAdapter`

```ts
export interface ExecutionAdapter {
  /** Stable backend identifier, e.g. 'agent-assistant-harness', 'claude', 'codex'. */
  readonly backendId: string;

  /** Return static or cheap-to-compute backend capabilities. */
  describeCapabilities(): ExecutionCapabilities;

  /**
   * Negotiate whether the backend can satisfy this request.
   * Must be side-effect free.
   */
  negotiate(request: ExecutionRequest): ExecutionNegotiation;

  /**
   * Execute one bounded request.
   * Must reject only for adapter/runtime faults; normal unsupported cases should be
   * surfaced through negotiate() or a structured execution result.
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

---

## 3.2 `ExecutionRequest`

```ts
export interface ExecutionRequest {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;

  /** Product-prepared visible request. */
  message: {
    id: string;
    text: string;
    receivedAt: string;
    attachments?: Array<{
      id: string;
      type: string;
      name?: string;
      url?: string;
      metadata?: Record<string, unknown>;
    }>;
  };

  /**
   * Product-prepared instruction bundle.
   * Usually derived from turn-context assembly.
   */
  instructions: {
    systemPrompt: string;
    developerPrompt?: string;
    responseStyle?: {
      preferMarkdown?: boolean;
      maxAnswerChars?: number;
    };
  };

  /** Prepared context blocks already chosen upstream. */
  context?: {
    blocks: Array<{
      id: string;
      label: string;
      text: string;
      category?: 'memory' | 'workspace' | 'enrichment' | 'guardrail' | 'other';
      metadata?: Record<string, unknown>;
    }>;
    structured?: Record<string, unknown>;
  };

  /** Optional resumable input carried from continuation-owned state. */
  continuation?: {
    continuationId?: string;
    kind?: 'clarification' | 'approval' | 'deferred' | string;
    state?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };

  /** Tools already selected by product/runtime policy. */
  tools?: Array<ExecutionToolDescriptor>;

  /** Execution semantics the caller expects. */
  requirements?: ExecutionRequirements;

  /** Optional trace and routing hints from upstream runtime. */
  metadata?: Record<string, unknown>;
}
```

### 3.2.1 Request rules

- `ExecutionRequest` is **post-assembly** input. The adapter must not assume responsibility for composing identity.
- `tools` are optional because some requests may be model-only.
- `continuation` is optional and referential. Continuation lifecycle remains outside the adapter.
- `requirements` exists for capability negotiation, not product policy.

---

## 3.3 `ExecutionToolDescriptor`

```ts
export interface ExecutionToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
  metadata?: Record<string, unknown>;
}
```

### Rule

This descriptor exists so adapters can expose tools to a backend in a normalized way.
It does **not** make the adapter the tool executor of record for the whole runtime architecture.

A concrete adapter may:
- proxy tool calls to a product/runtime-owned executor
- pass tools into the built-in harness
- reject tool-bearing requests if structured tool calling is unsupported

---

## 3.4 `ExecutionRequirements`

```ts
export interface ExecutionRequirements {
  toolUse?: 'forbidden' | 'allowed' | 'required';
  structuredToolCalls?: 'forbidden' | 'preferred' | 'required';
  continuationSupport?: 'none' | 'preferred' | 'required';
  approvalInterrupts?: 'none' | 'preferred' | 'required';
  traceDepth?: 'minimal' | 'standard' | 'detailed';
  attachments?: 'forbidden' | 'allowed' | 'required';
}
```

### Rule

The caller uses `required` only when the request is semantically invalid without that capability.
If a requirement is marked `preferred`, degradation is acceptable when truthfully reported.

---

## 3.5 `ExecutionCapabilities`

```ts
export interface ExecutionCapabilities {
  toolUse: 'none' | 'adapter-mediated' | 'native-iterative';
  structuredToolCalls: boolean;
  continuationSupport: 'none' | 'opaque-resume' | 'structured';
  approvalInterrupts: 'none' | 'adapter-mediated' | 'native';
  traceDepth: 'minimal' | 'standard' | 'detailed';
  attachments: boolean;
  maxContextStrategy?: 'unknown' | 'small' | 'medium' | 'large';
  notes?: string[];
}
```

### Capability meaning

- `toolUse`
  - `none`: backend cannot support tool-bearing execution through this adapter
  - `adapter-mediated`: adapter/runtime can mediate tool use even if backend is not natively iterative
  - `native-iterative`: backend supports iterative tool execution semantics cleanly

- `continuationSupport`
  - `none`: no meaningful resume affordance
  - `opaque-resume`: backend can resume in some way, but not with durable structured semantics the runtime can rely on fully
  - `structured`: backend can participate in explicit resumable execution with bounded structured state

- `approvalInterrupts`
  - `none`: backend cannot pause for approval in-band
  - `adapter-mediated`: runtime can hold or gate around backend execution
  - `native`: backend exposes an approval pause/interrupt semantic the adapter can normalize

---

## 3.6 `ExecutionNegotiation`

```ts
export interface ExecutionNegotiation {
  supported: boolean;
  degraded: boolean;
  reasons: ExecutionNegotiationReason[];
  effectiveCapabilities: ExecutionCapabilities;
}

export interface ExecutionNegotiationReason {
  code:
    | 'tool_use_unsupported'
    | 'structured_tool_calls_unsupported'
    | 'continuation_unsupported'
    | 'approval_interrupt_unsupported'
    | 'attachments_unsupported'
    | 'trace_depth_reduced'
    | 'context_pressure_expected'
    | 'other';
  message: string;
  severity: 'info' | 'warning' | 'blocking';
}
```

### Negotiation rules

1. `supported=false` when a required capability is absent.
2. `degraded=true` when the request can run but only with reduced semantics.
3. `effectiveCapabilities` must describe the reality the runtime should expect for this request.
4. `negotiate()` must not trigger execution or remote side effects.

---

## 3.7 `ExecutionResult`

```ts
export interface ExecutionResult {
  backendId: string;

  status:
    | 'completed'
    | 'needs_clarification'
    | 'awaiting_approval'
    | 'deferred'
    | 'failed'
    | 'unsupported';

  output?: {
    text?: string;
    attachments?: Array<{
      id: string;
      type: string;
      url?: string;
      name?: string;
      metadata?: Record<string, unknown>;
    }>;
    structured?: Record<string, unknown>;
  };

  continuation?: {
    kind: 'clarification' | 'approval' | 'deferred' | string;
    state?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };

  approvalRequest?: {
    reason?: string;
    approvalKey?: string;
    metadata?: Record<string, unknown>;
  };

  error?: {
    code:
      | 'unsupported_capability'
      | 'backend_execution_error'
      | 'invalid_backend_output'
      | 'tool_bridge_error'
      | 'timeout'
      | 'budget_exceeded'
      | 'other';
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  };

  trace?: ExecutionTrace;
  degradation?: ExecutionNegotiationReason[];
  metadata?: Record<string, unknown>;
}
```

### Result rules

1. `unsupported` is a valid structured result when execution could not be honored under the requested semantics.
2. `awaiting_approval` does **not** make the adapter the policy engine; it only reports that execution stopped pending approval semantics.
3. `continuation` is optional and informational unless the product/runtime decides to persist it through continuation-owned logic.
4. `failed` must be truthful; adapters must not convert backend failures into fake completions.

---

## 3.8 `ExecutionTrace`

```ts
export interface ExecutionTrace {
  summary: {
    startedAt?: string;
    completedAt?: string;
    stepCount?: number;
    toolCallCount?: number;
    degraded?: boolean;
  };
  events?: ExecutionTraceEvent[];
}

export interface ExecutionTraceEvent {
  type:
    | 'model_started'
    | 'model_completed'
    | 'tool_requested'
    | 'tool_completed'
    | 'approval_wait'
    | 'deferred'
    | 'failure'
    | 'note';
  at?: string;
  data?: Record<string, unknown>;
}
```

### Trace rule

Adapters may return shallow traces.
They must not fabricate event-level detail that the backend did not expose.

---

## 4. Execution flow

Canonical v1 flow:

1. product/runtime builds `ExecutionRequest`
2. caller invokes `adapter.negotiate(request)`
3. if `supported=false`, caller reroutes, reduces scope, or refuses honestly
4. if supported, caller invokes `adapter.execute(request)`
5. adapter translates request to backend-native shape
6. backend executes bounded work
7. adapter normalizes result into `ExecutionResult`
8. product/runtime applies policy/continuation/session/Relay behavior outside adapter ownership

---

## 5. Interaction with adjacent primitives

## 5.1 `@agent-assistant/turn-context`

Upstream only.

Expected relationship:
- turn-context assembles product-facing identity and context
- caller projects that into `ExecutionRequest.instructions` and `ExecutionRequest.context`
- adapter consumes but does not assemble

## 5.2 `@agent-assistant/harness`

The first-party harness should be modelable as one execution backend.

That means a future internal adapter may wrap `HarnessRuntime.runTurn(...)` and normalize directly to `ExecutionResult`.

## 5.3 `@agent-assistant/continuation`

Continuation owns persistence and resume lifecycle.

Expected relationship:
- continuation supplies resumed input via `request.continuation`
- adapter may return `result.continuation`
- continuation package decides whether and how to persist/resume that result

## 5.4 `@agent-assistant/policy`

Policy stays outside the adapter.

Expected relationship:
- product/runtime may evaluate policy before execution
- product/runtime may interpret `awaiting_approval` or `approvalRequest`
- adapter does not call `policyEngine.evaluate()` or `recordApproval()` directly

## 5.5 `@agent-assistant/sessions`

Sessions provide continuity identifiers only.

Expected relationship:
- caller may pass `sessionId`
- adapter may include it in backend metadata/correlation
- adapter does not own session transitions

---

## 6. Required v1 behavioral constraints

### 6.1 Truthful degradation

If the backend cannot honor a required semantic, the adapter must:
- fail negotiation, or
- return `status='unsupported'`

It must not silently flatten the request into a weaker mode without signaling degradation.

### 6.2 No semantic laundering

Adapters must not relabel backend behavior as richer Agent Assistant semantics than were actually achieved.

Examples:
- backend text asking the human to approve something is not the same as native approval interrupt support
- dumping a transcript into prompt history is not the same as structured continuation support
- provider logs are not automatically equivalent to detailed execution traces

### 6.3 No ownership drift

Adapters must not absorb:
- product prompt composition
- policy logic
- continuation persistence
- Relay coordination logic
- session lifecycle logic

### 6.4 Side-effect boundaries

`negotiate()` must be side-effect free.

`execute()` may invoke remote backends and runtime-owned tool bridges, but must not mutate session/policy/continuation state directly unless explicitly called through caller-supplied collaborators outside this spec.

---

## 7. Minimal useful v1 test matrix

A future implementation is acceptable only if it proves these cases:

1. **Built-in harness adapter path**
   - request negotiated as supported
   - completed result normalized correctly

2. **External backend with reduced trace fidelity**
   - negotiation marks degradation
   - result trace is shallow but truthful

3. **Tool-required request on tool-less backend**
   - negotiation returns `supported=false`

4. **Preferred continuation on backend with no continuation support**
   - negotiation returns degraded support, not blocking

5. **Required continuation on backend with no continuation support**
   - negotiation returns blocking unsupported

6. **Approval-interrupt unsupported**
   - caller receives explicit degradation/blocking reason

7. **Backend failure**
   - normalized `failed` result with structured error

8. **No silent ownership drift**
   - adapter integration path does not call policy/session/continuation lifecycle APIs directly

---

## 8. Non-goals

This spec does not define:
- a public npm package name
- provider-specific auth/config management
- a generic model SDK
- a cross-backend tool execution fabric
- multi-agent orchestration inside the adapter
- a scheduler or wake-up subsystem
- a universal attachment format for all providers beyond the minimal normalized contract above

---

## 9. Definition of done

This spec is satisfied for v1 when:
- the first-party harness can be wrapped through this contract internally
- one external backend can negotiate capability gaps explicitly
- a product can branch on `ExecutionNegotiation` and `ExecutionResult` without provider-specific business logic everywhere
- policy, continuation, sessions, and Relay coordination remain outside adapter ownership
- degradation behavior is truthful and testable

---

## 10. Bottom line

The execution adapter contract should stay small.

It needs to answer only three questions well:
1. what does this backend support?
2. can it run this bounded request honestly?
3. what normalized result came back?

That is enough to enable BYOH execution without surrendering Agent Assistant’s identity, Relay-native coordination model, or product-owned intelligence.
