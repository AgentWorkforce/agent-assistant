export interface ExecutionAdapter {
  readonly backendId: string;
  describeCapabilities(): ExecutionCapabilities;
  negotiate(request: ExecutionRequest): ExecutionNegotiation;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  executeStreaming?(request: ExecutionRequest): AsyncIterable<ExecutionStreamEvent>;
}

export interface ExecutionRequest {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;
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
  instructions: {
    systemPrompt: string;
    developerPrompt?: string;
    responseStyle?: {
      preferMarkdown?: boolean;
      maxAnswerChars?: number;
    };
  };
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
  continuation?: {
    continuationId?: string;
    kind?: 'clarification' | 'approval' | 'deferred' | string;
    state?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  signal?: AbortSignal;
  tools?: ExecutionToolDescriptor[];
  requirements?: ExecutionRequirements;
  metadata?: Record<string, unknown>;
}

export interface ExecutionToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ExecutionRequirements {
  toolUse?: 'forbidden' | 'allowed' | 'required';
  structuredToolCalls?: 'forbidden' | 'preferred' | 'required';
  continuationSupport?: 'none' | 'preferred' | 'required';
  approvalInterrupts?: 'none' | 'preferred' | 'required';
  traceDepth?: 'minimal' | 'standard' | 'detailed';
  attachments?: 'forbidden' | 'allowed' | 'required';
  streaming?: 'forbidden' | 'preferred' | 'required';
}

export interface ExecutionCapabilities {
  toolUse: 'none' | 'adapter-mediated' | 'native-iterative';
  structuredToolCalls: boolean;
  continuationSupport: 'none' | 'opaque-resume' | 'structured';
  approvalInterrupts: 'none' | 'adapter-mediated' | 'native';
  traceDepth: 'minimal' | 'standard' | 'detailed';
  attachments: boolean;
  streaming?: 'none' | 'native' | 'adapter-mediated';
  maxContextStrategy?: 'unknown' | 'small' | 'medium' | 'large';
  notes?: string[];
}

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
  metadata?: Record<string, unknown>;
}

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
      | 'cancelled'
      | 'other';
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  };
  trace?: ExecutionTrace;
  degradation?: ExecutionNegotiationReason[];
  metadata?: Record<string, unknown>;
}

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

export type ExecutionStreamEvent =
  | { type: 'text_delta'; text: string; index?: number }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_delta'; callId: string; name?: string; argsDelta: string }
  | { type: 'tool_started'; callId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_finished'; callId: string; result: ExecutionToolResult }
  | { type: 'tool_failed'; callId: string; error: ExecutionStreamError }
  | { type: 'step_finished'; iteration: number; usage?: ExecutionUsage }
  | { type: 'turn_finished'; result: ExecutionResult }
  | { type: 'error'; error: ExecutionStreamError };

export interface ExecutionStreamError {
  code:
    | 'cancelled'
    | 'timeout'
    | 'backend_execution_error'
    | 'invalid_backend_output'
    | 'tool_bridge_error'
    | 'unsupported_capability'
    | 'other';
  message: string;
  retryable?: boolean;
}

export interface ExecutionToolResult {
  callId: string;
  toolName: string;
  status: 'success' | 'error';
  output?: string;
  structuredOutput?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  };
  usage?: ExecutionUsage;
  metadata?: Record<string, unknown>;
}

export interface ExecutionUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUnits?: number;
  latencyMs?: number;
}
