# v1 Harness Spec — `@agent-assistant/harness`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-13
**Package:** `@agent-assistant/harness`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / wave-2 until implementation and consumer proof exist

---

## 1. Responsibilities

`@agent-assistant/harness` owns the bounded runtime for one assistant turn that may require iterative model/tool/model execution before it can complete honestly.

It exists to solve a specific product-grade gap between a thin assistant runtime and a sprawling autonomous framework.

**Owns:**
- bounded turn execution
- iterative tool-use loop for a single turn
- clarification / approval / deferred continuation outcomes
- truthful stop reasons
- compact continuation payload contract
- trace/telemetry event contract for turn execution
- adapter interfaces for model invocation, tool execution, approvals, and trace sinks

**Does NOT own:**
- assistant definition or runtime lifecycle (→ `@agent-assistant/core`)
- session storage/lifecycle (→ `@agent-assistant/sessions`)
- memory storage/retrieval (→ `@agent-assistant/memory`)
- transport/surface delivery (→ `@agent-assistant/surfaces`)
- routing policy ownership (→ `@agent-assistant/routing`)
- specialist orchestration (→ `@agent-assistant/coordination`)
- action-policy ownership (→ `@agent-assistant/policy`)
- workforce persona definitions (model, harness, prompt, tier)
### Design principle — character is composable, not just prompted

The harness must be implemented so that consuming products can express assistant individuality through more than a system prompt.

This means the package design must remain compatible with future structured inputs for:
- base identity / traits
- behavioral shaping (for example humor, warmth, directness, initiative, explanation style)
- runtime enrichment from supporting agents and integrations
- guardrail layers that preserve coherence and appropriateness

The implementation does **not** need to ship a full character-composition subsystem in v1. But the public contracts, hooks, and runtime assumptions must not trap the SDK in a prompt-only customization model.

Runtime enrichment signals may later include cultural/reference context from integrations (for example short-form culture/trend sources) or supporting-agent contributions. These inputs should inform expression, not replace the assistant's core identity.

---

## 2. Non-goals

- The harness is not a long-running autonomous agent.
- The harness is not a scheduler, daemon, queue worker, or cron engine.
- The harness is not a swarm engine or recursive delegation system.
- The harness does not store long-term memory.
- The harness does not own product prompts, business rules, or tool definitions.
- The harness does not guarantee eventual task success.
- The harness does not hide bounded failure behind fake completion text.

---

## 3. Canonical execution model

A harness invocation runs **one bounded turn**.

The turn starts with:
- one user request or equivalent product trigger
- one set of product-supplied instructions/context
- zero or one continuation payload
- one set of available tools

The turn ends with exactly one `HarnessResult`.

Within that turn, the harness may:
- call the model multiple times
- execute multiple tool calls
- recover from an incomplete first attempt
- stop with a clarification/approval/deferred result instead of pretending completion

The harness must not keep running after it returns a final result.

---

## 4. Interfaces and contracts

### 4.1 `HarnessRuntime`

```typescript
export interface HarnessRuntime {
  /**
   * Execute one bounded assistant turn.
   */
  runTurn(input: HarnessTurnInput): Promise<HarnessResult>;
}
```

### 4.2 `HarnessConfig`

```typescript
export interface HarnessConfig {
  model: HarnessModelAdapter;
  tools?: HarnessToolRegistry;
  approvals?: HarnessApprovalAdapter;
  trace?: HarnessTraceSink;
  clock?: HarnessClock;
  limits?: HarnessLimits;
  hooks?: HarnessHooks;
}
```

### 4.3 `HarnessLimits`

```typescript
export interface HarnessLimits {
  /** Maximum model/tool/model loop iterations. Default: 6 */
  maxIterations?: number;

  /** Maximum total tool calls in one turn. Default: 8 */
  maxToolCalls?: number;

  /** Maximum elapsed wall time for the turn. Default: 30000 */
  maxElapsedMs?: number;

  /** Optional abstract budget ceiling. Undefined means disabled. */
  budgetLimit?: number;

  /** Maximum consecutive invalid model outputs before failing. Default: 2 */
  maxConsecutiveInvalidModelOutputs?: number;
}
```

### 4.4 `HarnessTurnInput`

```typescript
export interface HarnessTurnInput {
  /** Stable assistant identifier. */
  assistantId: string;

  /** Product-generated unique turn id. */
  turnId: string;

  /** Session id when available. */
  sessionId?: string;

  /** User id when available. */
  userId?: string;

  /** Product-specific thread id when different from session id. */
  threadId?: string;

  /** Raw user-visible request for this turn. */
  message: HarnessUserMessage;

  /** Product-supplied system prompt / instruction bundle. */
  instructions: HarnessInstructions;

  /** Optional prepared context such as memory or workspace evidence. */
  context?: HarnessPreparedContext;

  /** Optional continuation payload emitted by a previous result. */
  continuation?: HarnessContinuation;

  /** Optional per-turn tool allowlist override. */
  allowedToolNames?: string[];

  /** Optional metadata carried into trace events. */
  metadata?: Record<string, unknown>;
}
```

### 4.5 `HarnessUserMessage`

```typescript
export interface HarnessUserMessage {
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
}
```

### 4.6 `HarnessInstructions`

```typescript
export interface HarnessInstructions {
  /** Product/persona/system prompt text. */
  systemPrompt: string;

  /** Optional assistant-facing guidance assembled by product code. */
  developerPrompt?: string;

  /** Optional response contract guidance. */
  responseStyle?: {
    preferMarkdown?: boolean;
    maxAnswerChars?: number;
  };
}
```

### 4.7 `HarnessPreparedContext`

```typescript
export interface HarnessPreparedContext {
  /** Human-readable context blocks prepared by product code. */
  blocks: HarnessContextBlock[];

  /** Optional structured values the model adapter may surface separately. */
  structured?: Record<string, unknown>;
}

export interface HarnessContextBlock {
  id: string;
  label: string;
  content: string;
  importance?: 'low' | 'medium' | 'high';
  source?: string;
}
```

### 4.8 `HarnessModelAdapter`

```typescript
export interface HarnessModelAdapter {
  /**
   * Produce the next assistant step for the current turn state.
   */
  nextStep(input: HarnessModelInput): Promise<HarnessModelOutput>;
}
```

### 4.9 `HarnessModelInput`

```typescript
export interface HarnessModelInput {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
  message: HarnessUserMessage;
  instructions: HarnessInstructions;
  context?: HarnessPreparedContext;
  continuation?: HarnessContinuation;
  transcript: HarnessTranscriptItem[];
  availableTools: HarnessToolDefinition[];
  iteration: number;
  toolCallCount: number;
  elapsedMs: number;
  remainingBudget?: number;
  metadata?: Record<string, unknown>;
}
```

### 4.10 `HarnessModelOutput`

The model output is intentionally structured into a small bounded set.

```typescript
export type HarnessModelOutput =
  | HarnessFinalAnswerOutput
  | HarnessToolRequestOutput
  | HarnessClarificationOutput
  | HarnessApprovalRequestOutput
  | HarnessRefusalOutput
  | HarnessInvalidOutput;

export interface HarnessFinalAnswerOutput {
  type: 'final_answer';
  text: string;
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export interface HarnessToolRequestOutput {
  type: 'tool_request';
  calls: HarnessToolCall[];
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export interface HarnessClarificationOutput {
  type: 'clarification';
  question: string;
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export interface HarnessApprovalRequestOutput {
  type: 'approval_request';
  request: HarnessApprovalRequest;
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export interface HarnessRefusalOutput {
  type: 'refusal';
  reason: string;
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export interface HarnessInvalidOutput {
  type: 'invalid';
  reason: string;
  raw?: unknown;
  usage?: HarnessUsage;
}
```

### 4.11 `HarnessToolRegistry` and tool contracts

```typescript
export interface HarnessToolRegistry {
  listAvailable(input: HarnessToolAvailabilityInput): Promise<HarnessToolDefinition[]>;
  execute(call: HarnessToolCall, context: HarnessToolExecutionContext): Promise<HarnessToolResult>;
}

export interface HarnessToolAvailabilityInput {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  allowedToolNames?: string[];
}

export interface HarnessToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
  metadata?: Record<string, unknown>;
}

export interface HarnessToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface HarnessToolExecutionContext {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
  iteration: number;
  toolCallIndex: number;
}

export interface HarnessToolResult {
  callId: string;
  toolName: string;
  status: 'success' | 'error';
  output?: string;
  structuredOutput?: Record<string, unknown>;
  error?: HarnessToolError;
  usage?: HarnessUsage;
  metadata?: Record<string, unknown>;
}

export interface HarnessToolError {
  code: string;
  message: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
}
```

### 4.12 `HarnessApprovalAdapter`

This adapter allows the harness to express approval-blocked turns without owning policy itself.

```typescript
export interface HarnessApprovalAdapter {
  prepareRequest(input: HarnessApprovalRequestInput): Promise<HarnessPreparedApproval>;
}

export interface HarnessApprovalRequestInput {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  request: HarnessApprovalRequest;
}

export interface HarnessApprovalRequest {
  id: string;
  kind: string;
  summary: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessPreparedApproval {
  request: HarnessApprovalRequest;
  continuation: HarnessContinuation;
}
```

### 4.13 `HarnessContinuation`

```typescript
export interface HarnessContinuation {
  id: string;
  type: 'clarification' | 'approval' | 'deferred';
  createdAt: string;
  turnId: string;
  sessionId?: string;
  resumeToken: string;
  state: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

### 4.14 Transcript items

```typescript
export type HarnessTranscriptItem =
  | HarnessAssistantThoughtStep
  | HarnessToolResultStep
  | HarnessClarificationStep
  | HarnessApprovalStep;

export interface HarnessAssistantThoughtStep {
  type: 'assistant_step';
  iteration: number;
  outputType:
    | 'final_answer'
    | 'tool_request'
    | 'clarification'
    | 'approval_request'
    | 'refusal'
    | 'invalid';
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessToolResultStep {
  type: 'tool_result';
  iteration: number;
  result: HarnessToolResult;
}

export interface HarnessClarificationStep {
  type: 'clarification_request';
  iteration: number;
  question: string;
}

export interface HarnessApprovalStep {
  type: 'approval_request';
  iteration: number;
  request: HarnessApprovalRequest;
}
```

### 4.15 `HarnessUsage`

```typescript
export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUnits?: number;
  latencyMs?: number;
}
```

### 4.16 `HarnessResult`

```typescript
export interface HarnessResult {
  outcome: HarnessOutcome;
  stopReason: HarnessStopReason;
  turnId: string;
  sessionId?: string;
  assistantMessage?: HarnessAssistantMessage;
  continuation?: HarnessContinuation;
  traceSummary: HarnessTraceSummary;
  usage: HarnessAggregateUsage;
  metadata?: Record<string, unknown>;
}

export type HarnessOutcome =
  | 'completed'
  | 'needs_clarification'
  | 'awaiting_approval'
  | 'deferred'
  | 'failed';

export type HarnessStopReason =
  | 'answer_finalized'
  | 'clarification_required'
  | 'approval_required'
  | 'max_iterations_reached'
  | 'max_tool_calls_reached'
  | 'timeout_reached'
  | 'budget_reached'
  | 'tool_unavailable'
  | 'tool_error_unrecoverable'
  | 'model_refused'
  | 'model_invalid_response'
  | 'runtime_error'
  | 'cancelled';

export interface HarnessAssistantMessage {
  text: string;
  format?: Record<string, unknown>;
}

export interface HarnessAggregateUsage {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUnits?: number;
  totalLatencyMs?: number;
  modelCalls: number;
  toolCalls: number;
}

export interface HarnessTraceSummary {
  iterationCount: number;
  toolCallCount: number;
  hadContinuation: boolean;
  finalEventType: string;
}
```

### 4.17 `HarnessTraceSink`

```typescript
export interface HarnessTraceSink {
  emit(event: HarnessTraceEvent): Promise<void> | void;
}

export type HarnessTraceEvent =
  | HarnessTurnStartedEvent
  | HarnessTurnFinishedEvent
  | HarnessModelStepStartedEvent
  | HarnessModelStepFinishedEvent
  | HarnessToolRequestedEvent
  | HarnessToolStartedEvent
  | HarnessToolFinishedEvent
  | HarnessToolFailedEvent
  | HarnessClarificationEvent
  | HarnessApprovalEvent
  | HarnessLimitReachedEvent;

export interface HarnessBaseTraceEvent {
  type: string;
  timestamp: string;
  assistantId: string;
  turnId: string;
  sessionId?: string;
  iteration?: number;
  toolCallCount?: number;
  elapsedMs?: number;
  metadata?: Record<string, unknown>;
}

export interface HarnessTurnStartedEvent extends HarnessBaseTraceEvent {
  type: 'turn_started';
}

export interface HarnessTurnFinishedEvent extends HarnessBaseTraceEvent {
  type: 'turn_finished';
  outcome: HarnessOutcome;
  stopReason: HarnessStopReason;
}

export interface HarnessModelStepStartedEvent extends HarnessBaseTraceEvent {
  type: 'model_step_started';
}

export interface HarnessModelStepFinishedEvent extends HarnessBaseTraceEvent {
  type: 'model_step_finished';
  outputType: HarnessModelOutput['type'];
  usage?: HarnessUsage;
}

export interface HarnessToolRequestedEvent extends HarnessBaseTraceEvent {
  type: 'tool_requested';
  calls: HarnessToolCall[];
}

export interface HarnessToolStartedEvent extends HarnessBaseTraceEvent {
  type: 'tool_started';
  call: HarnessToolCall;
}

export interface HarnessToolFinishedEvent extends HarnessBaseTraceEvent {
  type: 'tool_finished';
  result: HarnessToolResult;
}

export interface HarnessToolFailedEvent extends HarnessBaseTraceEvent {
  type: 'tool_failed';
  result: HarnessToolResult;
}

export interface HarnessClarificationEvent extends HarnessBaseTraceEvent {
  type: 'clarification_requested';
  question: string;
}

export interface HarnessApprovalEvent extends HarnessBaseTraceEvent {
  type: 'approval_requested';
  request: HarnessApprovalRequest;
}

export interface HarnessLimitReachedEvent extends HarnessBaseTraceEvent {
  type: 'limit_reached';
  stopReason:
    | 'max_iterations_reached'
    | 'max_tool_calls_reached'
    | 'timeout_reached'
    | 'budget_reached';
}
```

### 4.18 `HarnessHooks`

```typescript
export interface HarnessHooks {
  onInvalidModelOutput?: (
    output: HarnessInvalidOutput,
    state: HarnessExecutionState,
  ) => Promise<void> | void;

  onToolError?: (
    result: HarnessToolResult,
    state: HarnessExecutionState,
  ) => Promise<void> | void;
}

export interface HarnessExecutionState {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  iteration: number;
  toolCallCount: number;
  elapsedMs: number;
}
```

### 4.19 `HarnessClock`

```typescript
export interface HarnessClock {
  now(): number;
  nowIso(): string;
}
```

---

## 5. Factory

```typescript
export function createHarness(config: HarnessConfig): HarnessRuntime;
```

### Validation requirements

The factory must reject invalid config via `HarnessConfigError` when:
- `model` is missing
- numeric limits are zero/negative where not allowed
- `maxConsecutiveInvalidModelOutputs` is less than 1
- adapter shapes are invalid

```typescript
export class HarnessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessConfigError';
  }
}
```

---

## 6. Required runtime behavior

### 6.1 Turn start

When `runTurn()` starts, the harness must:
1. initialize counters and elapsed-time tracking
2. resolve available tools from the registry, or `[]` if no tool registry exists
3. emit `turn_started`
4. enter the bounded loop

### 6.2 Per-iteration flow

For each iteration:
1. enforce limits before model invocation
2. emit `model_step_started`
3. call `model.nextStep(...)`
4. emit `model_step_finished`
5. append a transcript item
6. branch on output type

### 6.3 Final answer behavior

For `type: 'final_answer'`:
- stop immediately with:
  - `outcome: 'completed'`
  - `stopReason: 'answer_finalized'`
  - `assistantMessage.text = output.text`
- emit `turn_finished`

### 6.4 Clarification behavior

For `type: 'clarification'`:
- create a `HarnessContinuation` with `type: 'clarification'`
- stop with:
  - `outcome: 'needs_clarification'`
  - `stopReason: 'clarification_required'`
  - `assistantMessage.text = output.question`
- emit `clarification_requested`
- emit `turn_finished`

### 6.5 Approval behavior

For `type: 'approval_request'`:
- if `approvals` adapter is present, call `prepareRequest(...)`
- otherwise create a continuation directly
- stop with:
  - `outcome: 'awaiting_approval'`
  - `stopReason: 'approval_required'`
  - `continuation` populated
- emit `approval_requested`
- emit `turn_finished`

### 6.6 Tool request behavior

For `type: 'tool_request'`:
- reject empty `calls` as invalid output
- ensure each tool exists in available tools
- if any tool is unavailable, stop with:
  - `outcome: 'failed'`
  - `stopReason: 'tool_unavailable'`
- enforce `maxToolCalls`
- execute requested calls sequentially in v1
- append tool results to transcript
- continue the loop unless a non-retryable unrecoverable tool error requires stop

### 6.7 Refusal behavior

For `type: 'refusal'`:
- stop with:
  - `outcome: 'failed'`
  - `stopReason: 'model_refused'`
- the result may include an `assistantMessage` carrying a safe refusal explanation when appropriate
- emit `turn_finished`

### 6.8 Invalid-output behavior

For `type: 'invalid'` or structurally invalid model output:
- increment consecutive invalid-output counter
- call `hooks.onInvalidModelOutput` when present
- if the invalid counter exceeds the configured limit, stop with:
  - `outcome: 'failed'`
  - `stopReason: 'model_invalid_response'`
- otherwise continue the loop with a transcript record of the invalid step

### 6.9 Tool error behavior

If a tool returns `status: 'error'`:
- emit `tool_failed`
- call `hooks.onToolError` when present
- if `retryable === true`, the harness may continue and let the model decide next step
- if `retryable !== true` and the product/tool result marks the failure unrecoverable, stop with:
  - `outcome: 'failed'`
  - `stopReason: 'tool_error_unrecoverable'`

### 6.10 Limits behavior

If any limit is reached, the harness must stop truthfully.

#### Max iterations
- stop with `outcome: 'deferred'`
- `stopReason: 'max_iterations_reached'`
- emit `limit_reached`
- include a `deferred` continuation

#### Max tool calls
- stop with `outcome: 'deferred'`
- `stopReason: 'max_tool_calls_reached'`
- emit `limit_reached`
- include a `deferred` continuation

#### Timeout
- stop with `outcome: 'deferred'`
- `stopReason: 'timeout_reached'`
- emit `limit_reached`
- include a `deferred` continuation

#### Budget ceiling
- stop with `outcome: 'deferred'`
- `stopReason: 'budget_reached'`
- emit `limit_reached`
- include a `deferred` continuation

### 6.11 Runtime errors

Unexpected thrown errors from adapters or harness internals must be caught and surfaced as:
- `outcome: 'failed'`
- `stopReason: 'runtime_error'`

The harness must still attempt to emit `turn_finished`.

---

## 7. Continuation rules

### Continuation creation

A continuation is required for these outcomes:
- `needs_clarification`
- `awaiting_approval`
- `deferred`

A continuation is optional for `failed` and must not be emitted for a normal `completed` result.

### Continuation content rules

The continuation `state` must be compact and bounded. It may include:
- prior stop reason
- minimal transcript summary
- pending approval metadata
- pending clarification metadata
- tool/result correlation fields

It must not include:
- unbounded raw conversation history
- provider-specific hidden scratchpad blobs that products cannot inspect
- secret model internals unavailable to the product

### Resume contract

Products resume by calling `runTurn()` again with:
- a new `turnId`
- the new inbound message or trigger
- the prior continuation in `input.continuation`

The harness does not persist continuation state itself.

---

## 8. Package boundaries

### Depends on (internal)
- `@agent-assistant/core` — type-level compatibility and assistant-runtime composition

### May integrate with (internal, optional at product seam)
- `@agent-assistant/sessions`
- `@agent-assistant/policy`
- `@agent-assistant/routing`

### Must not depend on directly for core behavior
- `@agent-assistant/coordination`
- `@agent-assistant/memory`
- `@agent-assistant/surfaces`

### Relay / Workforce boundary
- No direct dependency on relay transport packages
- No ownership of Workforce personas or model-tier definitions

---

## 9. Integration with `@agent-assistant/core`

The harness does not replace `AssistantRuntime`. Products use it inside capability handlers.

Canonical registration pattern:

```typescript
runtime.register('harness', harnessRuntime);
```

Canonical use inside a capability handler:

```typescript
const harness = context.runtime.get<HarnessRuntime>('harness');

const result = await harness.runTurn({
  assistantId: runtime.definition.id,
  turnId: 'turn-123',
  sessionId: message.sessionId,
  userId: message.userId,
  message: {
    id: message.id,
    text: message.text,
    receivedAt: message.receivedAt,
  },
  instructions: {
    systemPrompt: 'You are Sage...',
  },
});
```

The product then maps `HarnessResult` to outbound behavior.

---

## 10. OSS vs cloud boundary

All interfaces, factory functions, in-memory/default helpers, and trace schemas are OSS.

Hosted observability, cloud persistence of continuation payloads, or managed approval backends must remain optional adapters outside this package.

A self-hosted consumer must be able to use this package with:
- a local model adapter
- a local tool registry
- a no-op or in-memory trace sink

---

## 11. Open questions

| # | Question | Owner | Resolution target |
|---|---|---|---|
| OQ-1 | Should tool calls in v1 be strictly sequential, or can same-iteration parallel tool execution be allowed when explicitly requested? | Harness | Before implementation starts |
| OQ-2 | Should `failed + tool_unavailable` always omit `assistantMessage`, or may products opt into a user-facing explanation string from the harness? | Harness + consumers | Before example assembly |
| OQ-3 | How compact should transcript summary inside `HarnessContinuation.state` be by default? | Harness | First implementation slice |
| OQ-4 | Should budget be abstract `costUnits` only in v1, or also token ceilings directly? | Harness + routing | First implementation slice |
| OQ-5 | Should the harness expose a helper for mapping `HarnessResult` to common UI states, or leave that entirely to products? Current recommendation: leave to products in v1. | Harness | v1.1 |

---

## 12. First implementation slice

Implement in this order.

### Step 1 — Types and factory validation
- Export all public interfaces and error classes
- Implement `createHarness(config)` validation
- Tests: invalid config rejection; valid config construction

### Step 2 — Minimal loop with final-answer completion
- Support `final_answer` output only
- Emit `turn_started`, `model_step_started`, `model_step_finished`, `turn_finished`
- Tests: happy-path completion, usage aggregation, trace emission

### Step 3 — Tool request loop
- Add tool listing, tool execution, transcript accumulation, second model step
- Enforce `maxToolCalls`
- Tests: one-tool path, multi-tool path, unavailable tool, retryable and unrecoverable tool errors

### Step 4 — Clarification and approval outcomes
- Add continuation generation for clarification/approval
- Tests: clarification result, approval result, continuation presence and shape

### Step 5 — Invalid output and refusal handling
- Add invalid-output counter and refusal stop
- Tests: one invalid then recover, repeated invalid leading to failure, refusal stop

### Step 6 — Limit enforcement and deferred outcomes
- Add iteration/time/budget ceilings
- Tests: max-iteration, timeout, budget, deferred continuation generation

### Step 7 — Core integration example
- Register harness on an `AssistantRuntime`
- Add a product-style example showing result mapping to outbound responses
- Prefer a Sage-shaped example because it exercises the intended seam directly

**Definition of done:** a product can replace a brittle one-shot planner/executor/synthesizer turn path with `runTurn()` and can truthfully handle completion, clarification, approval wait, bounded deferral, and failure using the returned result.

SPEC_READY
IMPLEMENTATION_READY
