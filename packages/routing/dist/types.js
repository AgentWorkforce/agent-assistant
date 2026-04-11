export const ROUTING_MODES = ['cheap', 'fast', 'deep'];
export const MODEL_TIERS = ['small', 'medium', 'large', 'frontier'];
export const ROUTING_REASONS = [
    'policy_default',
    'capability_override',
    'escalation_signal',
    'cost_envelope_exceeded',
    'latency_constraint',
    'caller_requested',
    'hard_constraint',
];
export const MODE_DEPTH = {
    cheap: 0,
    fast: 1,
    deep: 2,
};
export const DEFAULT_MODE_SPECS = {
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
    constructor(message) {
        super(message);
        this.name = 'RoutingError';
    }
}
export class RoutingPolicyError extends RoutingError {
    constructor(message) {
        super(message);
        this.name = 'RoutingPolicyError';
    }
}
