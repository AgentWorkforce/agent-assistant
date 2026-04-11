import { describe, expect, it } from 'vitest';
import { createRouter } from './routing.js';
const escalationHookContract = createRouter();
void escalationHookContract;
function createSignal(overrides = {}) {
    return {
        id: 'sig-1',
        threadId: 'thread-1',
        source: 'connectivity',
        signalClass: 'escalation.interrupt',
        priority: 'high',
        summary: 'Urgent interrupt',
        ...overrides,
    };
}
describe('routing decisions', () => {
    it('uses the default fast policy when nothing else applies', () => {
        const router = createRouter();
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
        });
        expect(decision.mode).toBe('fast');
        expect(decision.reason).toBe('policy_default');
        expect(decision.modelSpec.tier).toBe('medium');
        expect(decision.modelSpec.minContextTokens).toBe(16000);
        expect(decision.escalated).toBe(false);
        expect(decision.overridden).toBe(false);
    });
    it('prefers a caller requested mode over a capability override', () => {
        const router = createRouter({
            policy: {
                capabilityModes: {
                    respond: 'cheap',
                },
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
            requestedMode: 'deep',
        });
        expect(decision.mode).toBe('deep');
        expect(decision.reason).toBe('caller_requested');
    });
    it('caps caller mode with the hard ceiling', () => {
        const router = createRouter({
            policy: {
                modeCeiling: 'fast',
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
            requestedMode: 'deep',
        });
        expect(decision.mode).toBe('fast');
        expect(decision.reason).toBe('hard_constraint');
        expect(decision.overridden).toBe(true);
        expect(decision.modelSpec.mode).toBe('fast');
    });
    it('uses capability mode when there is no caller override', () => {
        const router = createRouter({
            policy: {
                capabilityModes: {
                    summarize: 'cheap',
                },
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'summarize',
        });
        expect(decision.mode).toBe('cheap');
        expect(decision.reason).toBe('capability_override');
    });
    it('downgrades to cheap when the cost envelope is exceeded', () => {
        const router = createRouter({
            policy: {
                defaultMode: 'deep',
                costEnvelopeLimit: 10,
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
            accumulatedCost: 11,
            activeEscalations: [
                {
                    signalClass: 'escalation.interrupt',
                    priority: 'critical',
                },
            ],
        });
        expect(decision.mode).toBe('cheap');
        expect(decision.reason).toBe('cost_envelope_exceeded');
        expect(decision.escalated).toBe(false);
    });
    it('selects the highest priority mapped escalation and marks the decision escalated', () => {
        const router = createRouter({
            policy: {
                escalationModeMap: {
                    'escalation.review': 'fast',
                    'escalation.interrupt': 'deep',
                },
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
            activeEscalations: [
                {
                    signalClass: 'escalation.review',
                    priority: 'high',
                },
                {
                    signalClass: 'escalation.interrupt',
                    priority: 'critical',
                },
            ],
        });
        expect(decision.mode).toBe('deep');
        expect(decision.reason).toBe('escalation_signal');
        expect(decision.escalated).toBe(true);
    });
    it('applies latency policy before falling back to the default mode', () => {
        const router = createRouter({
            policy: {
                defaultMode: 'deep',
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'respond',
            requestedMaxLatencyMs: 2000,
        });
        expect(decision.mode).toBe('cheap');
        expect(decision.reason).toBe('latency_constraint');
        expect(decision.modelSpec.maxLatencyMs).toBe(2000);
    });
    it('merges policy spec overrides with context requirements', () => {
        const router = createRouter({
            policy: {
                defaultMode: 'cheap',
                modeModelSpecs: {
                    cheap: {
                        tier: 'value-worker',
                        requiresStreaming: false,
                        minContextTokens: 2048,
                        hints: {
                            workforceProfile: 'cheap-lane',
                        },
                    },
                },
            },
        });
        const decision = router.decide({
            threadId: 'thread-1',
            capability: 'classify',
            requiresToolUse: true,
            requiresStreaming: true,
            minContextTokens: 4096,
            requestedMaxLatencyMs: 1500,
        });
        expect(decision.modelSpec).toMatchObject({
            mode: 'cheap',
            tier: 'value-worker',
            requiresToolUse: true,
            requiresStreaming: true,
            minContextTokens: 4096,
            maxLatencyMs: 1500,
            hints: {
                workforceProfile: 'cheap-lane',
            },
        });
    });
});
describe('cost tracking', () => {
    it('tracks, reads, and resets accumulated thread cost', () => {
        const router = createRouter();
        router.recordCost('thread-1', 1.5);
        router.recordCost('thread-1', 2.25);
        expect(router.getAccumulatedCost('thread-1')).toBe(3.75);
        router.resetCost('thread-1');
        expect(router.getAccumulatedCost('thread-1')).toBe(0);
    });
});
describe('connectivity boundary', () => {
    it('returns a mapped requested mode for escalation signals', () => {
        const router = createRouter({
            policy: {
                escalationModeMap: {
                    'escalation.interrupt': 'deep',
                },
            },
        });
        expect(router.onEscalation(createSignal())).toBe('deep');
    });
    it('applies the ceiling to escalation hook responses', () => {
        const router = createRouter({
            policy: {
                modeCeiling: 'fast',
                escalationModeMap: {
                    'escalation.interrupt': 'deep',
                },
            },
        });
        expect(router.onEscalation(createSignal())).toBe('fast');
    });
    it('ignores non-escalation classes and unmapped signals', () => {
        const router = createRouter({
            policy: {
                escalationModeMap: {
                    'escalation.interrupt': 'deep',
                },
            },
        });
        expect(router.onEscalation(createSignal({ signalClass: 'status.presence' }))).toBeUndefined();
        expect(router.onEscalation(createSignal({ signalClass: 'escalation.review' }))).toBeUndefined();
    });
});
