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
export type RoutingReason = 'policy_default' | 'capability_override' | 'escalation_signal' | 'cost_envelope_exceeded' | 'latency_constraint' | 'caller_requested' | 'hard_constraint';
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
export declare const ROUTING_MODES: readonly ["cheap", "fast", "deep"];
export declare const MODEL_TIERS: readonly ["small", "medium", "large", "frontier"];
export declare const ROUTING_REASONS: readonly ["policy_default", "capability_override", "escalation_signal", "cost_envelope_exceeded", "latency_constraint", "caller_requested", "hard_constraint"];
export declare const MODE_DEPTH: Record<RoutingMode, number>;
export declare const DEFAULT_MODE_SPECS: Record<RoutingMode, ModelSpec>;
export declare class RoutingError extends Error {
    constructor(message: string);
}
export declare class RoutingPolicyError extends RoutingError {
    constructor(message: string);
}
