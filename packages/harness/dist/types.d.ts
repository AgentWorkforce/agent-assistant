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
export type HarnessModelOutput = HarnessFinalAnswerOutput | HarnessToolRequestOutput | HarnessClarificationOutput | HarnessApprovalRequestOutput | HarnessRefusalOutput | HarnessInvalidOutput;
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
export type HarnessTranscriptItem = HarnessAssistantThoughtStep | HarnessToolResultStep | HarnessClarificationStep | HarnessApprovalStep;
export interface HarnessAssistantThoughtStep {
    type: 'assistant_step';
    iteration: number;
    outputType: 'final_answer' | 'tool_request' | 'clarification' | 'approval_request' | 'refusal' | 'invalid';
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
export type HarnessOutcome = 'completed' | 'needs_clarification' | 'awaiting_approval' | 'deferred' | 'failed';
export type HarnessStopReason = 'answer_finalized' | 'clarification_required' | 'approval_required' | 'max_iterations_reached' | 'max_tool_calls_reached' | 'timeout_reached' | 'budget_reached' | 'tool_unavailable' | 'tool_error_unrecoverable' | 'model_refused' | 'model_invalid_response' | 'runtime_error' | 'cancelled';
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
export type HarnessTraceEvent = HarnessTurnStartedEvent | HarnessTurnFinishedEvent | HarnessModelStepStartedEvent | HarnessModelStepFinishedEvent | HarnessToolRequestedEvent | HarnessToolStartedEvent | HarnessToolFinishedEvent | HarnessToolFailedEvent | HarnessClarificationEvent | HarnessApprovalEvent | HarnessLimitReachedEvent;
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
    stopReason: 'max_iterations_reached' | 'max_tool_calls_reached' | 'timeout_reached' | 'budget_reached';
}
export interface HarnessHooks {
    onInvalidModelOutput?: (output: HarnessInvalidOutput, state: HarnessExecutionState) => Promise<void> | void;
    onToolError?: (result: HarnessToolResult, state: HarnessExecutionState) => Promise<void> | void;
    onTurnFinished?: (result: HarnessResult, state: HarnessExecutionState) => Promise<void> | void;
}
export interface HarnessExecutionState {
    assistantId: string;
    turnId: string;
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
export declare class HarnessConfigError extends Error {
    constructor(message: string);
}
