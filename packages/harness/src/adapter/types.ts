export interface ExecutionAdapter {
  readonly backendId: string;
  describeCapabilities(): ExecutionCapabilities;
  negotiate(request: ExecutionRequest): ExecutionNegotiation;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
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
}

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
