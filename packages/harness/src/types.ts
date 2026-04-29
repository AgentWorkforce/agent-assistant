export interface HarnessRuntime {
  runTurn(input: HarnessTurnInput): Promise<HarnessResult>;
}

export interface HarnessConfig {
  model: HarnessModelAdapter;
  tools?: HarnessToolRegistry;
  approvals?: HarnessApprovalAdapter;
  trace?: HarnessTraceSink;
  clock?: HarnessClock;
  limits?: HarnessLimits;
  hooks?: HarnessHooks;
  /**
   * In-turn auto-retry policy for tool calls that return
   * `{ status: 'error', error: { retryable: true } }`. Retries happen
   * inside the same logical tool call — they do NOT consume an iteration
   * or tool-call budget slot. Defaults to 2 retries (3 total attempts)
   * with backoff [200ms, 500ms].
   *
   * Each retry attempt emits a `tool_retried` trace event so operators
   * can see when underlying providers are flaky. After all retries are
   * exhausted, the original `tool_failed` event is emitted with the last
   * error and the existing tool-error handling kicks in.
   */
  toolRetryConfig?: HarnessToolRetryConfig;
}

export interface HarnessToolRetryConfig {
  /**
   * Maximum number of retries after the initial attempt. Total attempts
   * is `maxRetries + 1`. Set to 0 to disable auto-retry.
   */
  maxRetries: number;
  /**
   * Per-retry backoff in milliseconds. The first retry waits
   * `backoffMs[0]`, the second `backoffMs[1]`, etc. If the array is
   * shorter than `maxRetries`, the last value is reused for remaining
   * retries.
   */
  backoffMs: number[];
}

export interface HarnessLimits {
  maxIterations?: number;
  maxToolCalls?: number;
  maxElapsedMs?: number;
  budgetLimit?: number;
  maxConsecutiveInvalidModelOutputs?: number;
}

export interface HarnessTurnInput {
  assistantId: string;
  turnId: string;
  workspaceId?: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
  message: HarnessUserMessage;
  instructions: HarnessInstructions;
  context?: HarnessPreparedContext;
  continuation?: HarnessContinuation;
  allowedToolNames?: string[];
  metadata?: Record<string, unknown>;
}

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

export interface HarnessInstructions {
  systemPrompt: string;
  developerPrompt?: string;
  responseStyle?: {
    preferMarkdown?: boolean;
    maxAnswerChars?: number;
  };
}

export interface HarnessPreparedContext {
  blocks: HarnessContextBlock[];
  structured?: Record<string, unknown>;
}

export interface HarnessContextBlock {
  id: string;
  label: string;
  content: string;
  importance?: 'low' | 'medium' | 'high';
  source?: string;
}

export interface HarnessModelAdapter {
  nextStep(input: HarnessModelInput): Promise<HarnessModelOutput>;
}

export interface HarnessModelInput {
  assistantId: string;
  turnId: string;
  workspaceId?: string;
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
  /**
   * Machine-readable invalid-output class. Consumers should prefer this over
   * string matching `reason`; `reason` remains the stable human-readable field.
   */
  kind?: HarnessInvalidOutputKind;
  /**
   * Provider-specific error subcode. Optional; populated by adapters
   * (e.g. OpenRouter) so consumers can switch on a stable enum instead
   * of substring-matching the free-text `reason` field. `kind` remains
   * the high-level transient/provider_error split.
   */
  code?: HarnessInvalidOutputCode;
  reason: string;
  raw?: unknown;
  httpStatus?: number;
  retriedAt?: string;
  metadata?: Record<string, unknown>;
  usage?: HarnessUsage;
}

export type HarnessInvalidOutputKind =
  | 'transient'
  | 'schema_mismatch'
  | 'empty_response'
  | 'missing_message'
  | 'model_refused'
  | 'provider_error';

export type HarnessInvalidOutputCode =
  | 'credits_exhausted'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_request'
  | 'context_length_exceeded'
  | 'model_not_found'
  | 'auth_failed'
  | 'unknown';

export interface HarnessToolRegistry {
  listAvailable(input: HarnessToolAvailabilityInput): Promise<HarnessToolDefinition[]>;
  execute(call: HarnessToolCall, context: HarnessToolExecutionContext): Promise<HarnessToolResult>;
}

export interface HarnessToolAvailabilityInput {
  assistantId: string;
  turnId: string;
  workspaceId?: string;
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
  workspaceId?: string;
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

export interface HarnessApprovalAdapter {
  prepareRequest(input: HarnessApprovalRequestInput): Promise<HarnessPreparedApproval>;
}

export interface HarnessApprovalRequestInput {
  assistantId: string;
  turnId: string;
  workspaceId?: string;
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

export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUnits?: number;
  latencyMs?: number;
}

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
  | 'redundant_tool_loop'
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
  | HarnessToolRetriedEvent
  | HarnessClarificationEvent
  | HarnessApprovalEvent
  | HarnessLimitReachedEvent;

export interface HarnessBaseTraceEvent {
  type: string;
  timestamp: string;
  assistantId: string;
  turnId: string;
  workspaceId?: string;
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

export interface HarnessToolRetriedEvent extends HarnessBaseTraceEvent {
  type: 'tool_retried';
  call: HarnessToolCall;
  /** 1-indexed attempt number this retry will execute (the previous attempt failed). */
  attempt: number;
  /** Maximum attempts including the initial one (`maxRetries + 1`). */
  maxAttempts: number;
  /** Backoff applied before this attempt fires, in ms. */
  backoffMs: number;
  /** The retryable error from the previous attempt that triggered this retry. */
  previousError: HarnessToolError;
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
    | 'redundant_tool_loop'
    | 'timeout_reached'
    | 'budget_reached';
}

export interface HarnessHooks {
  clarifyOnToolResult?: HarnessToolEvidenceClarificationHook;
  onInvalidModelOutput?: (
    output: HarnessInvalidOutput,
    state: HarnessExecutionState,
  ) => Promise<void> | void;
  onToolError?: (
    result: HarnessToolResult,
    state: HarnessExecutionState,
  ) => Promise<void> | void;
  onTurnFinished?: (
    result: HarnessResult,
    state: HarnessExecutionState,
  ) => Promise<void> | void;
}

export type HarnessToolEvidenceClarificationReason =
  | 'empty_results'
  | 'ambiguous_identifier'
  | 'transient_provider_error'
  | 'custom';

export interface HarnessToolEvidenceClarification {
  question: string;
  reason: HarnessToolEvidenceClarificationReason;
  metadata?: Record<string, unknown>;
}

export type HarnessToolEvidenceClarificationHook = (
  result: HarnessToolResult,
  state: HarnessExecutionState,
) =>
  | Promise<HarnessToolEvidenceClarification | null | undefined>
  | HarnessToolEvidenceClarification
  | null
  | undefined;

export interface HarnessExecutionState {
  assistantId: string;
  turnId: string;
  workspaceId?: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
  iteration: number;
  toolCallCount: number;
  elapsedMs: number;
  input?: {
    message: HarnessUserMessage;
    instructions: HarnessInstructions;
  };
  transcript?: HarnessTranscriptItem[];
  modelCalls?: HarnessModelCallRecord[];
}

export interface HarnessModelCallRecord {
  iteration: number;
  modelId?: string;
  usage?: HarnessUsage;
  outputType: HarnessModelOutput['type'];
}

export interface HarnessClock {
  now(): number;
  nowIso(): string;
}

export class HarnessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessConfigError';
  }
}
