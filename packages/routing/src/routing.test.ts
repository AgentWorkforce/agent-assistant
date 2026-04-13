import { describe, expect, it } from 'vitest';

import { createRouter } from './routing.js';
import type { ConnectivityEscalationSignal, RoutingEscalationHook } from './types.js';

const escalationHookContract: RoutingEscalationHook = createRouter();
void escalationHookContract;

function createSignal(overrides: Partial<ConnectivityEscalationSignal> = {}): ConnectivityEscalationSignal {
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

describe('default behavior', () => {
  it('uses the default fast policy when nothing else applies', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.mode).toBe('fast');
  });

  it('uses policy_default as the default reason', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.reason).toBe('policy_default');
  });

  it('does not mark the default decision as escalated', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.escalated).toBe(false);
  });

  it('does not mark the default decision as overridden', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.overridden).toBe(false);
  });
});

describe('policy default mode', () => {
  it('supports cheap as the configured default mode', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
      },
    });

    expect(router.decide({ threadId: 'thread-1', capability: 'respond' }).mode).toBe('cheap');
  });

  it('supports deep as the configured default mode', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
      },
    });

    expect(router.decide({ threadId: 'thread-1', capability: 'respond' }).mode).toBe('deep');
  });
});

describe('caller override', () => {
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
  });

  it('uses caller_requested as the reason for an accepted caller override', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requestedMode: 'deep',
    });

    expect(decision.reason).toBe('caller_requested');
  });

  it('caps caller mode with the hard ceiling without marking it escalated', () => {
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
    expect(decision.escalated).toBe(false);
    expect(decision.modelSpec.mode).toBe('fast');
  });
});

describe('capability override', () => {
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
  });

  it('uses capability_override as the reason for a capability match', () => {
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

    expect(decision.reason).toBe('capability_override');
  });

  it('does not apply a capability override to a different capability', () => {
    const router = createRouter({
      policy: {
        capabilityModes: {
          summarize: 'cheap',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'analyze',
    });

    expect(decision.mode).toBe('fast');
    expect(decision.reason).toBe('policy_default');
  });
});

describe('cost envelope', () => {
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
    });

    expect(decision.mode).toBe('cheap');
  });

  it('uses cost_envelope_exceeded as the reason when the cost envelope trips', () => {
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
    });

    expect(decision.reason).toBe('cost_envelope_exceeded');
  });

  it('does not downgrade when accumulated cost is exactly at the limit', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
        costEnvelopeLimit: 10,
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      accumulatedCost: 10,
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('policy_default');
  });

  it('treats a zero cost envelope limit as no limit', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
        costEnvelopeLimit: 0,
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      accumulatedCost: 9999,
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('policy_default');
  });
});

describe('escalation signals', () => {
  it('maps an active escalation to the configured mode', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'high',
        },
      ],
    });

    expect(decision.mode).toBe('deep');
  });

  it('marks escalation-driven routing as escalated', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'high',
        },
      ],
    });

    expect(decision.escalated).toBe(true);
  });

  it('uses escalation_signal as the reason when escalation mapping wins', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'high',
        },
      ],
    });

    expect(decision.reason).toBe('escalation_signal');
  });

  it('prefers the deeper mapped mode when escalations share the same priority', () => {
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
          priority: 'high',
        },
      ],
    });

    expect(decision.mode).toBe('deep');
  });

  it('prefers the highest priority mapped escalation over a deeper lower-priority one', () => {
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
          priority: 'critical',
        },
        {
          signalClass: 'escalation.interrupt',
          priority: 'high',
        },
      ],
    });

    expect(decision.mode).toBe('fast');
  });

  it('ignores escalation entries that are not mapped in policy', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
        escalationModeMap: {
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
          priority: 'critical',
        },
      ],
    });

    expect(decision.mode).toBe('cheap');
    expect(decision.reason).toBe('policy_default');
  });
});

describe('latency constraint', () => {
  it('downgrades from deep to cheap when neither deep nor fast can meet the requested latency', () => {
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
  });

  it('uses latency_constraint as the reason when latency drives selection', () => {
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

    expect(decision.reason).toBe('latency_constraint');
  });

  it('does not apply latency routing when no requestedMaxLatencyMs is provided', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('policy_default');
  });

  it('selects fast when fast can meet the latency target but deep cannot', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
        modeModelSpecs: {
          fast: {
            maxLatencyMs: 1500,
          },
          deep: {
            maxLatencyMs: 5000,
          },
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requestedMaxLatencyMs: 2000,
    });

    expect(decision.mode).toBe('fast');
  });
});

describe('mode ceiling', () => {
  it('caps escalation-driven deep mode to fast when the ceiling is fast', () => {
    const router = createRouter({
      policy: {
        modeCeiling: 'fast',
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'high',
        },
      ],
    });

    expect(decision.mode).toBe('fast');
    expect(decision.reason).toBe('hard_constraint');
    expect(decision.escalated).toBe(true);
  });

  it('caps the default fast mode to cheap when the ceiling is cheap', () => {
    const router = createRouter({
      policy: {
        modeCeiling: 'cheap',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.mode).toBe('cheap');
    expect(decision.reason).toBe('hard_constraint');
  });

  it('does not cap anything when the ceiling is deep', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
        modeCeiling: 'deep',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('policy_default');
  });

  it('marks a hard-constrained capability override as overridden', () => {
    const router = createRouter({
      policy: {
        modeCeiling: 'fast',
        capabilityModes: {
          analyze: 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'analyze',
    });

    expect(decision.mode).toBe('fast');
    expect(decision.overridden).toBe(true);
  });
});

describe('model spec construction', () => {
  it('uses the default fast tier for the default fast mode', () => {
    const router = createRouter();

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.modelSpec.tier).toBe('medium');
  });

  it('applies per-mode tier overrides from policy', () => {
    const router = createRouter({
      policy: {
        modeModelSpecs: {
          fast: {
            tier: 'large',
          },
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.modelSpec.tier).toBe('large');
  });

  it('lets context require tool use even when the mode default does not', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requiresToolUse: true,
    });

    expect(decision.modelSpec.requiresToolUse).toBe(true);
  });

  it('propagates requestedMaxLatencyMs into the returned model spec', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requestedMaxLatencyMs: 3000,
    });

    expect(decision.modelSpec.maxLatencyMs).toBe(3000);
  });

  it('preserves default hints while merging policy hint overrides', () => {
    const router = createRouter({
      defaultModelSpecs: {
        fast: {
          hints: {
            provider: 'default',
            lane: 'interactive',
          },
        },
      },
      policy: {
        modeModelSpecs: {
          fast: {
            hints: {
              lane: 'policy',
              region: 'eu',
            },
          },
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
    });

    expect(decision.modelSpec.hints).toEqual({
      provider: 'default',
      lane: 'policy',
      region: 'eu',
    });
  });

  it('raises minContextTokens to satisfy context requirements', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      minContextTokens: 4096,
    });

    expect(decision.modelSpec.minContextTokens).toBe(4096);
  });

  it('lets context require streaming even when the mode default does not', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requiresStreaming: true,
    });

    expect(decision.modelSpec.requiresStreaming).toBe(true);
  });
});

describe('cost tracking', () => {
  it('returns 0 for an unknown thread cost accumulator', () => {
    const router = createRouter();

    expect(router.getAccumulatedCost('unknown')).toBe(0);
  });

  it('accumulates cost within a thread', () => {
    const router = createRouter();

    router.recordCost('thread-1', 1.5);
    router.recordCost('thread-1', 2.25);

    expect(router.getAccumulatedCost('thread-1')).toBe(3.75);
  });

  it('resets accumulated cost for a thread', () => {
    const router = createRouter();

    router.recordCost('thread-1', 5);
    router.resetCost('thread-1');

    expect(router.getAccumulatedCost('thread-1')).toBe(0);
  });

  it('tracks cost independently per thread', () => {
    const router = createRouter();

    router.recordCost('thread-1', 10);
    router.recordCost('thread-2', 20);

    expect(router.getAccumulatedCost('thread-1')).toBe(10);
    expect(router.getAccumulatedCost('thread-2')).toBe(20);
  });

  it('throws when recordCost is called without a thread id', () => {
    const router = createRouter();

    expect(() => router.recordCost('', 1)).toThrow('threadId is required when recording cost');
  });

  it('throws when recordCost is called with a non-finite cost', () => {
    const router = createRouter();

    expect(() => router.recordCost('thread-1', Number.NaN)).toThrow('cost must be a finite number');
  });
});

describe('escalation hook', () => {
  it('returns a mapped requested mode for escalation.interrupt', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    expect(router.onEscalation(createSignal())).toBe('deep');
  });

  it('returns a mapped requested mode for escalation.uncertainty', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.uncertainty': 'fast',
        },
      },
    });

    expect(router.onEscalation(createSignal({ signalClass: 'escalation.uncertainty' }))).toBe('fast');
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

  it('returns undefined for unmapped escalation classes', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    expect(router.onEscalation(createSignal({ signalClass: 'escalation.review' }))).toBeUndefined();
  });

  it('returns undefined for non-escalation signal classes', () => {
    const router = createRouter({
      policy: {
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    expect(router.onEscalation(createSignal({ signalClass: 'status.presence' }))).toBeUndefined();
  });
});

describe('priority chain', () => {
  it('keeps caller override ahead of capability override', () => {
    const router = createRouter({
      policy: {
        capabilityModes: {
          chat: 'cheap',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'chat',
      requestedMode: 'deep',
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('caller_requested');
  });

  it('keeps cost envelope ahead of escalation signals', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'deep',
        costEnvelopeLimit: 10,
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
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
  });

  it('keeps capability override ahead of escalation signals', () => {
    const router = createRouter({
      policy: {
        capabilityModes: {
          summarize: 'cheap',
        },
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'summarize',
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'critical',
        },
      ],
    });

    expect(decision.mode).toBe('cheap');
    expect(decision.reason).toBe('capability_override');
  });

  it('keeps escalation signals ahead of latency constraints', () => {
    const router = createRouter({
      policy: {
        defaultMode: 'cheap',
        escalationModeMap: {
          'escalation.interrupt': 'deep',
        },
      },
    });

    const decision = router.decide({
      threadId: 'thread-1',
      capability: 'respond',
      requestedMaxLatencyMs: 1000,
      activeEscalations: [
        {
          signalClass: 'escalation.interrupt',
          priority: 'critical',
        },
      ],
    });

    expect(decision.mode).toBe('deep');
    expect(decision.reason).toBe('escalation_signal');
  });
});
