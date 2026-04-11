export type RoutingMode = 'cheap' | 'fast' | 'deep';

export type ModelTier = 'small' | 'medium' | 'large' | 'frontier' | string;

export interface ModelSpec {
  mode: RoutingMode;
  tier: ModelTier;
  requiresToolUse: boolean;
  requiresStreaming: boolean;
  minContextTokens: number;
  maxLatencyMs: number;
  hints: Record<string, unknown>;
}

export interface EscalationSummary {
  signalClass: string;
  priority: string;
  requestedMode?: string;
}

export interface RoutingContext {
  threadId: string;
  capability: string;
  accumulatedCost?: number;
  requestedMaxLatencyMs?: number;
  requiresToolUse?: boolean;
  requiresStreaming?: boolean;
  minContextTokens?: number;
  activeEscalations?: EscalationSummary[];
  requestedMode?: RoutingMode;
}

export type RoutingReason =
  | 'policy_default'
  | 'capability_override'
  | 'escalation_signal'
  | 'cost_envelope_exceeded'
  | 'latency_constraint'
  | 'caller_requested'
  | 'hard_constraint';

export interface RoutingDecision {
  mode: RoutingMode;
  modelSpec: ModelSpec;
  reason: RoutingReason;
  escalated: boolean;
  overridden: boolean;
}

export interface RoutingPolicy {
  defaultMode?: RoutingMode;
  capabilityModes?: Record<string, RoutingMode>;
  costEnvelopeLimit?: number;
  modeCeiling?: RoutingMode;
  escalationModeMap?: Partial<Record<string, RoutingMode>>;
  modeModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}

export interface ConnectivityEscalationSignal {
  id: string;
  threadId: string;
  source: string;
  signalClass: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
}

export type RequestedRoutingMode = RoutingMode;

export interface RoutingEscalationHook {
  onEscalation(signal: ConnectivityEscalationSignal): RequestedRoutingMode | void;
}

export interface Router extends RoutingEscalationHook {
  decide(context: RoutingContext): RoutingDecision;
  recordCost(threadId: string, cost: number): void;
  getAccumulatedCost(threadId: string): number;
  resetCost(threadId: string): void;
}

export interface RouterConfig {
  policy?: RoutingPolicy;
  defaultModelSpecs?: Partial<Record<RoutingMode, Partial<ModelSpec>>>;
}

export const ROUTING_MODES = ['cheap', 'fast', 'deep'] as const;
export const MODEL_TIERS = ['small', 'medium', 'large', 'frontier'] as const;
export const ROUTING_REASONS = [
  'policy_default',
  'capability_override',
  'escalation_signal',
  'cost_envelope_exceeded',
  'latency_constraint',
  'caller_requested',
  'hard_constraint',
] as const;

export const MODE_DEPTH: Record<RoutingMode, number> = {
  cheap: 0,
  fast: 1,
  deep: 2,
};

export const DEFAULT_MODE_SPECS: Record<RoutingMode, ModelSpec> = {
  cheap: {
    mode: 'cheap',
    tier: 'small',
    requiresToolUse: false,
    requiresStreaming: false,
    minContextTokens: 0,
    maxLatencyMs: 0,
    hints: {},
  },
  fast: {
    mode: 'fast',
    tier: 'medium',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 16000,
    maxLatencyMs: 5000,
    hints: {},
  },
  deep: {
    mode: 'deep',
    tier: 'large',
    requiresToolUse: true,
    requiresStreaming: true,
    minContextTokens: 64000,
    maxLatencyMs: 0,
    hints: {},
  },
};

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

export class RoutingPolicyError extends RoutingError {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingPolicyError';
  }
}
