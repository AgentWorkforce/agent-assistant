import { describe, expect, it } from 'vitest';

import { createConnectivityLayer } from '@agent-assistant/connectivity';

import {
  CoordinationBlockedError,
  CoordinationError,
  DelegationPlanError,
  SynthesisError,
  createCoordinator,
  createDelegationPlan,
  createSpecialistRegistry,
  createSynthesizer,
  validateDelegationPlan,
} from './index.js';
import type {
  CoordinationRouter,
  DelegationPlan,
  Specialist,
  SpecialistRegistry,
  SpecialistResult,
} from './types.js';

function makeResult(
  specialistName: string,
  output = `${specialistName} output`,
  status: SpecialistResult['status'] = 'complete',
): SpecialistResult {
  return {
    specialistName,
    output,
    status,
  };
}

function registerSpecialist(
  registry: SpecialistRegistry,
  name: string,
  execute?: Specialist['handler']['execute'],
): void {
  registry.register({
    name,
    description: `${name} specialist`,
    capabilities: [name],
    handler: {
      async execute(instruction, context) {
        if (execute) {
          return execute(instruction, context);
        }

        return makeResult(name, `${name} handled ${instruction}`);
      },
    },
  });
}

function createRegistryWithSpecialists(names: string[]): SpecialistRegistry {
  const registry = createSpecialistRegistry();
  for (const name of names) {
    registerSpecialist(registry, name);
  }

  return registry;
}

function createMockRouter(
  overrides: Partial<CoordinationRouter> = {},
): CoordinationRouter {
  const costs = new Map<string, number>();

  return {
    decide:
      overrides.decide ??
      (() => ({
        mode: 'fast',
        modelSpec: { tier: 'medium', hints: {} },
        reason: 'policy_default',
        escalated: false,
        overridden: false,
      })),
    recordCost:
      overrides.recordCost ??
      ((threadId, cost) => {
        costs.set(threadId, (costs.get(threadId) ?? 0) + cost);
      }),
    getAccumulatedCost:
      overrides.getAccumulatedCost ??
      ((threadId) => {
        return costs.get(threadId) ?? 0;
      }),
  };
}

describe('specialist registry', () => {
  it('registers specialists, rejects duplicates, and validates known specialists', () => {
    const registry = createSpecialistRegistry();
    registerSpecialist(registry, 'researcher', async () => makeResult('researcher', 'facts'));

    expect(registry.has('researcher')).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(() =>
      registry.register({
        name: 'researcher',
        description: 'duplicate',
        capabilities: [],
        handler: {
          async execute() {
            return makeResult('researcher', 'duplicate');
          },
        },
      }),
    ).toThrowError(CoordinationError);

    const validation = validateDelegationPlan(
      {
        intent: 'answer safely',
        steps: [
          { specialistName: 'researcher', instruction: 'find facts' },
          { specialistName: 'missing', instruction: 'write answer' },
        ],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'plan.steps[1] references unknown specialist missing',
    );
    expect(() =>
      createDelegationPlan(
        {
          intent: 'answer safely',
          steps: [{ specialistName: 'missing', instruction: 'write answer' }],
        },
        registry,
      ),
    ).toThrowError(DelegationPlanError);
  });

  it('list returns a defensive copy', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const listed = registry.list();
    listed.push({
      name: 'writer',
      description: 'writer specialist',
      capabilities: ['write'],
      handler: {
        async execute() {
          return makeResult('writer');
        },
      },
    });

    expect(listed).toHaveLength(2);
    expect(registry.list()).toHaveLength(1);
    expect(registry.has('writer')).toBe(false);
  });

  it('has returns false before registration and true after registration', () => {
    const registry = createSpecialistRegistry();

    expect(registry.has('researcher')).toBe(false);
    registerSpecialist(registry, 'researcher');
    expect(registry.has('researcher')).toBe(true);
  });

  it('register throws when name is an empty string', () => {
    const registry = createSpecialistRegistry();

    expect(() =>
      registry.register({
        name: '',
        description: 'invalid',
        capabilities: [],
        handler: {
          async execute() {
            return makeResult('invalid');
          },
        },
      }),
    ).toThrowError(CoordinationError);
  });

  it('register throws when name is whitespace only', () => {
    const registry = createSpecialistRegistry();

    expect(() =>
      registry.register({
        name: '   ',
        description: 'invalid',
        capabilities: [],
        handler: {
          async execute() {
            return makeResult('invalid');
          },
        },
      }),
    ).toThrowError(CoordinationError);
  });

  it('unregister is a no-op for an unknown specialist', () => {
    const registry = createSpecialistRegistry();

    expect(() => registry.unregister('missing')).not.toThrow();
    expect(registry.list()).toEqual([]);
  });

  it('get returns null for an unregistered specialist', () => {
    const registry = createSpecialistRegistry();

    expect(registry.get('missing')).toBeNull();
  });
});

describe('delegation plan validation', () => {
  it('returns invalid when intent is empty', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const validation = validateDelegationPlan(
      {
        intent: '',
        steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('plan.intent must be a non-empty string');
  });

  it('returns invalid when steps are empty', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const validation = validateDelegationPlan(
      {
        intent: 'answer',
        steps: [],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('plan.steps must contain at least one step');
  });

  it('returns invalid when a step instruction is empty', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const validation = validateDelegationPlan(
      {
        intent: 'answer',
        steps: [{ specialistName: 'researcher', instruction: '' }],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'plan.steps[0].instruction must be a non-empty string',
    );
  });

  it('returns invalid when a step specialist name is empty', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const validation = validateDelegationPlan(
      {
        intent: 'answer',
        steps: [{ specialistName: '', instruction: 'find facts' }],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'plan.steps[0].specialistName must be a non-empty string',
    );
  });

  it('accumulates multiple errors in a single validation pass', () => {
    const registry = createRegistryWithSpecialists(['researcher']);

    const validation = validateDelegationPlan(
      {
        intent: '',
        steps: [{ specialistName: 'missing', instruction: '' }],
      },
      registry,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([
      'plan.intent must be a non-empty string',
      'plan.steps[0] references unknown specialist missing',
      'plan.steps[0].instruction must be a non-empty string',
    ]);
  });

  it('returns invalid when steps exceed maxSteps', () => {
    const registry = createRegistryWithSpecialists(['researcher', 'writer']);

    const validation = validateDelegationPlan(
      {
        intent: 'answer',
        steps: [
          { specialistName: 'researcher', instruction: 'find facts' },
          { specialistName: 'writer', instruction: 'write answer' },
        ],
      },
      registry,
      1,
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('plan.steps exceeds maxSteps (1)');
  });

  it('createDelegationPlan returns a copy', () => {
    const registry = createRegistryWithSpecialists(['researcher']);
    const input: DelegationPlan = {
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    };

    const first = createDelegationPlan(input, registry);
    first.intent = 'mutated';
    first.steps[0]!.instruction = 'mutated';

    const second = createDelegationPlan(input, registry);
    expect(second.intent).toBe('answer');
    expect(second.steps[0]?.instruction).toBe('find facts');
  });
});

describe('synthesis strategies', () => {
  it('concatenate joins complete results with double newlines and complete quality', () => {
    const synthesizer = createSynthesizer({ strategy: 'concatenate' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    };

    const output = synthesizer.synthesize(
      [
        makeResult('researcher', 'fact pack', 'complete'),
        makeResult('writer', 'final answer', 'complete'),
      ],
      plan,
    );

    expect(output).toEqual({
      text: 'fact pack\n\nfinal answer',
      contributingSpecialists: ['researcher', 'writer'],
      quality: 'complete',
    });
  });

  it('concatenate excludes failed results from text and contributing specialists', () => {
    const synthesizer = createSynthesizer({ strategy: 'concatenate' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    };

    const output = synthesizer.synthesize(
      [
        makeResult('researcher', 'fact pack', 'complete'),
        makeResult('writer', 'failure text', 'failed'),
      ],
      plan,
    );

    expect(output).toEqual({
      text: 'fact pack',
      contributingSpecialists: ['researcher'],
      quality: 'degraded',
    });
  });

  it('concatenate returns degraded empty output when all results failed', () => {
    const synthesizer = createSynthesizer({ strategy: 'concatenate' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    };

    const output = synthesizer.synthesize(
      [makeResult('researcher', 'failure text', 'failed')],
      plan,
    );

    expect(output).toEqual({
      text: '',
      contributingSpecialists: [],
      quality: 'degraded',
    });
  });

  it('concatenate returns degraded quality when a result is partial', () => {
    const synthesizer = createSynthesizer({ strategy: 'concatenate' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    };

    const output = synthesizer.synthesize(
      [
        makeResult('researcher', 'fact pack', 'partial'),
        makeResult('writer', 'final answer', 'complete'),
      ],
      plan,
    );

    expect(output.quality).toBe('degraded');
    expect(output.text).toBe('fact pack\n\nfinal answer');
  });

  it('last-wins returns only the last non-failed result output', () => {
    const synthesizer = createSynthesizer({ strategy: 'last-wins' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'reviewer', instruction: 'review facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    };

    const output = synthesizer.synthesize(
      [
        makeResult('researcher', 'fact pack', 'complete'),
        makeResult('reviewer', 'failure text', 'failed'),
        makeResult('writer', 'final answer', 'complete'),
      ],
      plan,
    );

    expect(output).toEqual({
      text: 'final answer',
      contributingSpecialists: ['researcher', 'writer'],
      quality: 'degraded',
    });
  });

  it('last-wins returns degraded empty output when all results failed', () => {
    const synthesizer = createSynthesizer({ strategy: 'last-wins' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    };

    const output = synthesizer.synthesize(
      [makeResult('researcher', 'failure text', 'failed')],
      plan,
    );

    expect(output).toEqual({
      text: '',
      contributingSpecialists: [],
      quality: 'degraded',
    });
  });

  it('custom delegates to customFn and returns its output unchanged', () => {
    const synthesizer = createSynthesizer({
      strategy: 'custom',
      customFn(results, plan) {
        return {
          text: `${plan.intent}: ${results.map((result) => result.output).join(' | ')}`,
          contributingSpecialists: ['custom'],
          quality: 'degraded',
        };
      },
    });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    };

    const output = synthesizer.synthesize(
      [makeResult('researcher', 'fact pack', 'complete')],
      plan,
    );

    expect(output).toEqual({
      text: 'answer: fact pack',
      contributingSpecialists: ['custom'],
      quality: 'degraded',
    });
  });

  it('custom throws when customFn is missing', () => {
    const synthesizer = createSynthesizer({ strategy: 'custom' });
    const plan: DelegationPlan = {
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    };

    expect(() =>
      synthesizer.synthesize([makeResult('researcher', 'fact pack', 'complete')], plan),
    ).toThrowError(SynthesisError);
  });
});

describe('coordinator execution', () => {
  it('executes sequential delegation and resolves handoff signals after synthesis', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registerSpecialist(registry, 'researcher', async (_instruction, context) => {
      context.connectivity.emit({
        threadId: context.threadId,
        source: 'researcher',
        audience: 'selected',
        messageClass: 'handoff',
        signalClass: 'handoff.ready',
        priority: 'normal',
        summary: 'Evidence package ready for writing',
      });

      return {
        specialistName: 'researcher',
        output: 'Key evidence: the answer needs three concrete facts.',
        status: 'complete',
        confidence: 0.91,
      };
    });

    registerSpecialist(registry, 'writer', async (_instruction, context) => {
      expect(context.priorResults).toHaveLength(1);
      expect(context.priorResults[0]?.specialistName).toBe('researcher');

      context.connectivity.emit({
        threadId: context.threadId,
        source: 'writer',
        audience: 'coordinator',
        messageClass: 'confidence',
        signalClass: 'confidence.high',
        priority: 'normal',
        confidence: 0.93,
        summary: 'Final draft is ready',
      });

      return {
        specialistName: 'writer',
        output: `Final answer based on: ${context.priorResults[0]?.output}`,
        status: 'complete',
      };
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    const turn = await coordinator.execute({
      intent: 'produce one coherent answer',
      steps: [
        { specialistName: 'researcher', instruction: 'gather evidence' },
        { specialistName: 'writer', instruction: 'write the answer' },
      ],
    });

    expect(turn.results).toHaveLength(2);
    expect(turn.output.text).toContain('Final answer based on:');
    expect(turn.output.quality).toBe('complete');
    expect(turn.signals.handoffs).toHaveLength(1);
    expect(
      connectivity.query({
        threadId: turn.threadId,
        state: ['emitted', 'active'],
      }),
    ).toEqual([]);
  });

  it('skips optional failures and returns a degraded synthesized answer', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registerSpecialist(registry, 'reviewer', async () => {
      throw new Error('Reviewer unavailable');
    });
    registerSpecialist(registry, 'writer', async () => makeResult('writer', 'Fallback final answer'));

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer even if review is unavailable',
      steps: [
        { specialistName: 'reviewer', instruction: 'review draft', optional: true },
        { specialistName: 'writer', instruction: 'write final answer' },
      ],
    });

    expect(turn.results).toHaveLength(2);
    expect(turn.skippedSteps).toHaveLength(1);
    expect(turn.skippedSteps[0]?.specialistName).toBe('reviewer');
    expect(turn.output.text).toBe('Fallback final answer');
    expect(turn.output.quality).toBe('degraded');
  });

  it('halts when a specialist emits a blocker signal', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registerSpecialist(registry, 'reviewer', async (_instruction, context) => {
      context.connectivity.emit({
        threadId: context.threadId,
        source: 'reviewer',
        audience: 'coordinator',
        messageClass: 'confidence',
        signalClass: 'confidence.blocker',
        priority: 'high',
        confidence: 0,
        summary: 'Missing required evidence',
      });

      return makeResult('reviewer', 'Cannot continue', 'failed');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    await expect(
      coordinator.execute({
        intent: 'validate critical evidence',
        steps: [{ specialistName: 'reviewer', instruction: 'review evidence' }],
      }),
    ).rejects.toThrowError(CoordinationBlockedError);
  });

  it('tracks resolved conflicts without taking routing or transport ownership', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    let conflictId = '';

    registerSpecialist(registry, 'analyst', async (_instruction, context) => {
      const signal = context.connectivity.emit({
        threadId: context.threadId,
        source: 'analyst',
        audience: 'coordinator',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.42,
        summary: 'Two sources disagree on the timeline',
      });
      conflictId = signal.id;

      return makeResult('analyst', 'Conflict detected and isolated.', 'partial');
    });

    registerSpecialist(registry, 'arbiter', async (_instruction, context) => {
      context.connectivity.emit({
        threadId: context.threadId,
        source: 'arbiter',
        audience: 'coordinator',
        messageClass: 'conflict',
        signalClass: 'conflict.resolved',
        priority: 'normal',
        confidence: 0.88,
        summary: 'Timeline conflict resolved',
        replaces: conflictId,
      });

      return makeResult('arbiter', 'Resolved answer: source B has the correct timeline.');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'last-wins' },
    });

    const turn = await coordinator.execute({
      intent: 'resolve conflicting evidence into one answer',
      steps: [
        { specialistName: 'analyst', instruction: 'identify conflicts' },
        { specialistName: 'arbiter', instruction: 'resolve conflict' },
      ],
    });

    expect(turn.output.text).toContain('Resolved answer:');
    expect(turn.output.quality).toBe('degraded');
    expect(turn.signals.escalations).toHaveLength(0);
    expect(turn.signals.unresolvedConflicts).toHaveLength(0);
    expect(
      connectivity.query({
        threadId: turn.threadId,
        signalClass: 'conflict.active',
        state: ['superseded'],
      }),
    ).toHaveLength(1);
  });

  it('throws when maxSteps is zero', () => {
    const registry = createRegistryWithSpecialists(['researcher']);
    const connectivity = createConnectivityLayer();

    expect(() =>
      createCoordinator({
        registry,
        connectivity,
        synthesis: { strategy: 'concatenate' },
        maxSteps: 0,
      }),
    ).toThrowError(CoordinationError);
  });

  it('throws when maxSteps is negative', () => {
    const registry = createRegistryWithSpecialists(['researcher']);
    const connectivity = createConnectivityLayer();

    expect(() =>
      createCoordinator({
        registry,
        connectivity,
        synthesis: { strategy: 'concatenate' },
        maxSteps: -1,
      }),
    ).toThrowError(CoordinationError);
  });

  it('throws when maxSteps is not an integer', () => {
    const registry = createRegistryWithSpecialists(['researcher']);
    const connectivity = createConnectivityLayer();

    expect(() =>
      createCoordinator({
        registry,
        connectivity,
        synthesis: { strategy: 'concatenate' },
        maxSteps: 1.5,
      }),
    ).toThrowError(CoordinationError);
  });

  it('calls advanceStep once per successfully executed step', async () => {
    const registry = createRegistryWithSpecialists(['researcher', 'writer']);
    const connectivity = createConnectivityLayer();
    const originalAdvanceStep = connectivity.advanceStep.bind(connectivity);
    const advancedThreadIds: string[] = [];

    connectivity.advanceStep = (threadId) => {
      advancedThreadIds.push(threadId);
      originalAdvanceStep(threadId);
    };

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    });

    expect(advancedThreadIds).toEqual([turn.threadId, turn.threadId]);
  });

  it('unsubscribes from signals even when execution throws', async () => {
    const registry = createSpecialistRegistry();
    const connectivity = createConnectivityLayer();
    const originalOnSignal = connectivity.onSignal.bind(connectivity);
    const originalOffSignal = connectivity.offSignal.bind(connectivity);
    let subscribedCallback:
      | Parameters<typeof connectivity.onSignal>[0]
      | undefined;
    const unsubscribedCallbacks: Array<Parameters<typeof connectivity.onSignal>[0]> = [];

    connectivity.onSignal = (callback) => {
      subscribedCallback = callback;
      originalOnSignal(callback);
    };
    connectivity.offSignal = (callback) => {
      unsubscribedCallbacks.push(callback);
      originalOffSignal(callback);
    };

    registerSpecialist(registry, 'researcher', async () => {
      throw new Error('boom');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    await expect(
      coordinator.execute({
        intent: 'answer',
        steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
      }),
    ).rejects.toThrowError(CoordinationError);

    expect(subscribedCallback).toBeDefined();
    expect(unsubscribedCallbacks).toHaveLength(1);
    expect(unsubscribedCallbacks[0]).toBe(subscribedCallback);
  });

  it('aborts on a required step failure and does not execute subsequent steps', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    let secondStepExecutions = 0;

    registerSpecialist(registry, 'researcher', async () => {
      throw new Error('research failed');
    });
    registerSpecialist(registry, 'writer', async () => {
      secondStepExecutions += 1;
      return makeResult('writer', 'should not execute');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    await expect(
      coordinator.execute({
        intent: 'answer',
        steps: [
          { specialistName: 'researcher', instruction: 'find facts' },
          { specialistName: 'writer', instruction: 'write answer' },
        ],
      }),
    ).rejects.toThrowError(CoordinationError);

    expect(secondStepExecutions).toBe(0);
  });

  it('rejects a plan that exceeds maxSteps during execution', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createRegistryWithSpecialists(['researcher', 'writer']);
    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
      maxSteps: 1,
    });

    await expect(
      coordinator.execute({
        intent: 'answer',
        steps: [
          { specialistName: 'researcher', instruction: 'find facts' },
          { specialistName: 'writer', instruction: 'write answer' },
        ],
      }),
    ).rejects.toThrowError(DelegationPlanError);
  });

  it('uses the coord_ prefix for turn ids', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createRegistryWithSpecialists(['researcher']);
    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    });

    expect(turn.turnId.startsWith('coord_')).toBe(true);
  });

  it('registers a selected audience resolver scoped to the current plan participants', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    const originalRegisterSelectedResolver =
      connectivity.registerSelectedResolver.bind(connectivity);
    let resolver:
      | Parameters<typeof connectivity.registerSelectedResolver>[0]
      | undefined;

    connectivity.registerSelectedResolver = (nextResolver) => {
      resolver = nextResolver;
      originalRegisterSelectedResolver(nextResolver);
    };

    registerSpecialist(registry, 'researcher', async (_instruction, context) => {
      context.connectivity.emit({
        threadId: context.threadId,
        source: 'researcher',
        audience: 'selected',
        messageClass: 'handoff',
        signalClass: 'handoff.ready',
        priority: 'normal',
        summary: 'Send evidence to the next specialists',
      });

      return makeResult('researcher', 'fact pack');
    });
    registerSpecialist(registry, 'writer', async () => makeResult('writer', 'draft'));
    registerSpecialist(registry, 'reviewer', async () => makeResult('reviewer', 'review'));

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'draft answer' },
        { specialistName: 'reviewer', instruction: 'review answer' },
      ],
    });

    expect(resolver).toBeDefined();
    expect(turn.signals.handoffs).toHaveLength(1);
    expect(resolver?.(turn.signals.handoffs[0]!)).toEqual(['writer', 'reviewer']);
  });

  it('forwards router decisions into specialist context and the turn result', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    const decideCalls: Array<{
      threadId: string;
      capability: string;
      accumulatedCost?: number;
    }> = [];
    const observedModes: Array<string | undefined> = [];
    const router = createMockRouter({
      decide(context) {
        decideCalls.push(context);

        return {
          mode: context.capability === 'researcher' ? 'cheap' : 'deep',
          modelSpec: {
            tier: context.capability === 'researcher' ? 'small' : 'large',
            hints: { capability: context.capability },
          },
          reason: context.capability === 'researcher' ? 'policy_default' : 'escalation_signal',
          escalated: context.capability === 'writer',
          overridden: false,
        };
      },
    });

    registerSpecialist(registry, 'researcher', async (_instruction, context) => {
      observedModes.push(context.routingDecision?.mode);
      expect(context.routingDecision).toMatchObject({
        mode: 'cheap',
        tier: 'small',
        reason: 'policy_default',
        escalated: false,
        overridden: false,
      });

      return makeResult('researcher', 'fact pack');
    });

    registerSpecialist(registry, 'writer', async (_instruction, context) => {
      observedModes.push(context.routingDecision?.mode);
      expect(context.routingDecision).toMatchObject({
        mode: 'deep',
        tier: 'large',
        reason: 'escalation_signal',
        escalated: true,
        overridden: false,
      });

      return makeResult('writer', 'final answer');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
      router,
    });

    const turn = await coordinator.execute({
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    });

    expect(observedModes).toEqual(['cheap', 'deep']);
    expect(decideCalls).toHaveLength(2);
    expect(decideCalls[0]).toMatchObject({
      threadId: turn.threadId,
      capability: 'researcher',
      accumulatedCost: 0,
    });
    expect(decideCalls[1]).toMatchObject({
      threadId: turn.threadId,
      capability: 'writer',
      accumulatedCost: 0,
    });
    expect(turn.routingDecisions).toEqual([
      {
        stepIndex: 0,
        specialistName: 'researcher',
        mode: 'cheap',
        reason: 'policy_default',
      },
      {
        stepIndex: 1,
        specialistName: 'writer',
        mode: 'deep',
        reason: 'escalation_signal',
      },
    ]);
  });

  it('records finite positive step cost and passes accumulated cost into later decisions', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    const decideCalls: Array<{
      capability: string;
      accumulatedCost: number;
    }> = [];
    const recordedCosts: number[] = [];
    const accumulatedCosts = new Map<string, number>();
    const router = createMockRouter({
      decide(context) {
        decideCalls.push({
          capability: context.capability,
          accumulatedCost: context.accumulatedCost ?? 0,
        });

        return {
          mode: 'fast',
          modelSpec: { tier: 'medium', hints: {} },
          reason: 'policy_default',
          escalated: false,
          overridden: false,
        };
      },
      recordCost(threadId, cost) {
        recordedCosts.push(cost);
        accumulatedCosts.set(threadId, (accumulatedCosts.get(threadId) ?? 0) + cost);
      },
      getAccumulatedCost(threadId) {
        return accumulatedCosts.get(threadId) ?? 0;
      },
    });

    registerSpecialist(registry, 'researcher', async () => ({
      specialistName: 'researcher',
      output: 'fact pack',
      status: 'complete',
      metadata: {
        cost: 2.5,
      },
    }));
    registerSpecialist(registry, 'writer', async () => ({
      specialistName: 'writer',
      output: 'final answer',
      status: 'complete',
      metadata: {
        cost: '3.25',
      },
    }));

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
      router,
    });

    await coordinator.execute({
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
      ],
    });

    expect(recordedCosts).toEqual([2.5, 3.25]);
    expect(decideCalls).toEqual([
      { capability: 'researcher', accumulatedCost: 0 },
      { capability: 'writer', accumulatedCost: 2.5 },
    ]);
  });

  it('ignores missing and non-finite cost metadata when recording router cost', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();
    const recordedCosts: number[] = [];
    const router = createMockRouter({
      recordCost(_threadId, cost) {
        recordedCosts.push(cost);
      },
    });

    registerSpecialist(registry, 'researcher', async () => ({
      specialistName: 'researcher',
      output: 'fact pack',
      status: 'complete',
    }));
    registerSpecialist(registry, 'writer', async () => ({
      specialistName: 'writer',
      output: 'final answer',
      status: 'complete',
      metadata: {
        cost: 'NaN',
      },
    }));
    registerSpecialist(registry, 'reviewer', async () => ({
      specialistName: 'reviewer',
      output: 'reviewed',
      status: 'complete',
      metadata: {
        cost: Number.POSITIVE_INFINITY,
      },
    }));

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
      router,
    });

    await coordinator.execute({
      intent: 'answer',
      steps: [
        { specialistName: 'researcher', instruction: 'find facts' },
        { specialistName: 'writer', instruction: 'write answer' },
        { specialistName: 'reviewer', instruction: 'review answer' },
      ],
    });

    expect(recordedCosts).toEqual([]);
  });

  it('leaves routing context undefined when no router is configured', async () => {
    const connectivity = createConnectivityLayer();
    const registry = createSpecialistRegistry();

    registerSpecialist(registry, 'researcher', async (_instruction, context) => {
      expect(context.routingDecision).toBeUndefined();
      return makeResult('researcher', 'fact pack');
    });

    const coordinator = createCoordinator({
      registry,
      connectivity,
      synthesis: { strategy: 'concatenate' },
    });

    const turn = await coordinator.execute({
      intent: 'answer',
      steps: [{ specialistName: 'researcher', instruction: 'find facts' }],
    });

    expect(turn.routingDecisions).toBeUndefined();
  });
});
