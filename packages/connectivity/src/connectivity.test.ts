import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectivityError,
  MESSAGE_CLASS_TO_SIGNAL_PREFIX,
  SignalNotFoundError,
  SignalValidationError,
  createConnectivityLayer,
} from './index.js';
import type {
  ConnectivityLayer,
  EmitSignalInput,
  SignalClass,
  SignalEvent,
  SignalState,
} from './types.js';

function baseInput(overrides: Partial<EmitSignalInput> = {}): EmitSignalInput {
  return {
    threadId: 'thread-1',
    source: 'specialist:reviewer',
    audience: 'coordinator',
    messageClass: 'confidence',
    signalClass: 'confidence.high',
    priority: 'normal',
    confidence: 0.9,
    summary: 'Ready for synthesis',
    ...overrides,
  };
}

function nonConfidenceInput(
  overrides: Partial<Omit<EmitSignalInput, 'confidence'>> = {},
): EmitSignalInput {
  const input = baseInput(overrides as Partial<EmitSignalInput>);
  const { confidence: _confidence, ...withoutConfidence } = input;
  return withoutConfidence;
}

function createLayer(): ConnectivityLayer {
  return createConnectivityLayer();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('type and validation behavior', () => {
  it('exports signal prefixes that align with every signal class', () => {
    const signalClasses: SignalClass[] = [
      'attention.raise',
      'confidence.high',
      'confidence.medium',
      'confidence.low',
      'confidence.blocker',
      'conflict.active',
      'conflict.resolved',
      'handoff.ready',
      'handoff.partial',
      'escalation.interrupt',
      'escalation.uncertainty',
    ];

    for (const signalClass of signalClasses) {
      const [messageClass] = signalClass.split('.') as [keyof typeof MESSAGE_CLASS_TO_SIGNAL_PREFIX];
      expect(signalClass.startsWith(MESSAGE_CLASS_TO_SIGNAL_PREFIX[messageClass])).toBe(true);
    }
  });

  it('rejects inconsistent messageClass and signalClass combinations', () => {
    const layer = createLayer();

    expect(() =>
      layer.emit(
        baseInput({
          messageClass: 'attention',
          signalClass: 'confidence.high',
        }),
      ),
    ).toThrowError(SignalValidationError);
  });

  it('rejects invalid class-specific confidence ranges', () => {
    const layer = createLayer();

    expect(() =>
      layer.emit(
        baseInput({
          signalClass: 'confidence.blocker',
          confidence: 0.1,
          summary: 'Blocked',
        }),
      ),
    ).toThrowError(SignalValidationError);
  });
});

describe('emit, get, and query', () => {
  it('assigns ids and timestamps on emit', () => {
    const layer = createLayer();
    const signal = layer.emit(baseInput());

    expect(signal.id.startsWith('sig_')).toBe(true);
    expect(new Date(signal.emittedAt).toISOString()).toBe(signal.emittedAt);
    expect(signal.state).toBe('emitted');
  });

  it('returns null when a signal is missing', () => {
    expect(createLayer().get('missing')).toBeNull();
  });

  it('supports querying by class, state, priority, limit, and order', () => {
    vi.useFakeTimers();
    const layer = createLayer();

    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const first = layer.emit(baseInput());

    vi.setSystemTime(new Date('2026-04-11T00:00:01.000Z'));
    layer.onSignal(() => undefined);
    const second = layer.emit(
      baseInput({
        signalClass: 'conflict.active',
        messageClass: 'conflict',
        priority: 'high',
        confidence: 0.6,
        summary: 'Conflict found',
      }),
    );

    const conflicts = layer.query({
      threadId: 'thread-1',
      messageClass: 'conflict',
    });
    const actives = layer.query({
      threadId: 'thread-1',
      state: ['active'],
    });
    const oldest = layer.query({
      threadId: 'thread-1',
      state: ['emitted', 'active'],
      order: 'oldest',
      limit: 1,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.id).toBe(second.id);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.id).toBe(second.id);
    expect(oldest.map((item) => item.id)).toEqual([first.id]);
  });

  it('returns an empty array for unknown threads', () => {
    expect(createLayer().query({ threadId: 'missing' })).toEqual([]);
  });
});

describe('lifecycle, suppression, and expiry', () => {
  it('resolves emitted and active signals, idempotently for resolved signals', () => {
    const layer = createLayer();
    const emitted = layer.emit(baseInput());
    expect(layer.resolve(emitted.id).state).toBe('resolved');
    expect(layer.resolve(emitted.id).state).toBe('resolved');

    layer.onSignal(() => undefined);
    const active = layer.emit(
      baseInput({
        summary: 'Active signal',
      }),
    );
    expect(active.state).toBe('active');
    expect(layer.resolve(active.id).state).toBe('resolved');
  });

  it('throws for unknown or terminal signals during resolve', () => {
    const layer = createLayer();
    const original = layer.emit(baseInput());
    layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Updated confidence',
        replaces: original.id,
      }),
    );

    expect(() => layer.resolve('missing')).toThrowError(SignalNotFoundError);
    expect(() => layer.resolve(original.id)).toThrowError(ConnectivityError);
  });

  it('suppresses duplicates within a step and allows them after resolution or step advance', () => {
    const layer = createLayer();
    const first = layer.emit(baseInput());
    const suppressed = layer.emit(baseInput({ summary: 'A different summary still suppresses' }));

    expect(suppressed.id).toBe(first.id);
    expect(layer.query({ threadId: 'thread-1', state: ['emitted', 'active'] })).toHaveLength(1);

    layer.resolve(first.id);
    const afterResolve = layer.emit(baseInput({ summary: 'Re-opened after resolve' }));
    expect(afterResolve.id).not.toBe(first.id);

    layer.advanceStep('thread-1');
    const afterStep = layer.emit(baseInput({ summary: 'Allowed on next step' }));
    expect(afterStep.id).not.toBe(afterResolve.id);
  });

  it('bypasses suppression for critical signals and for high-priority escalation summaries that differ', () => {
    const layer = createLayer();

    const criticalA = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.interrupt',
        priority: 'critical',
        summary: 'Stop current plan',
      }),
    );
    const criticalB = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.interrupt',
        priority: 'critical',
        summary: 'Stop current plan again',
      }),
    );
    const highA = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.uncertainty',
        priority: 'high',
        summary: 'Need deeper routing for ambiguity A',
      }),
    );
    const highB = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.uncertainty',
        priority: 'high',
        summary: 'Need deeper routing for ambiguity B',
      }),
    );

    expect(criticalB.id).not.toBe(criticalA.id);
    expect(highB.id).not.toBe(highA.id);
  });

  it('supports time-basis suppression windows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const layer = createConnectivityLayer({
      suppressionConfig: {
        basis: 'time',
        windowMs: 500,
      },
    });

    const first = layer.emit(baseInput());
    vi.setSystemTime(new Date('2026-04-11T00:00:00.250Z'));
    expect(layer.emit(baseInput()).id).toBe(first.id);

    vi.setSystemTime(new Date('2026-04-11T00:00:00.800Z'));
    expect(layer.emit(baseInput()).id).not.toBe(first.id);
  });

  it('expires signals by step and ignores already-terminal signals', () => {
    const layer = createLayer();
    const expiring = layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        expiresAtStep: 1,
        summary: 'Short-lived context',
      }),
    );
    const resolved = layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Will resolve before expiry',
        expiresAtStep: 1,
      }),
    );
    layer.resolve(resolved.id);

    layer.advanceStep('thread-1');

    expect(layer.get(expiring.id)?.state).toBe('expired');
    expect(layer.get(resolved.id)?.state).toBe('resolved');
    expect(() => layer.advanceStep('missing')).not.toThrow();
  });

  it('does not suppress otherwise-identical signals when the audience differs', () => {
    const layer = createLayer();

    const coordinatorSignal = layer.emit(baseInput());
    const selectedSignal = layer.emit(
      baseInput({
        audience: 'selected',
      }),
    );

    expect(selectedSignal.id).not.toBe(coordinatorSignal.id);
  });

  it('does not fire callbacks for suppressed emits', () => {
    const layer = createLayer();
    const callback = vi.fn();
    layer.onSignal(callback);

    const first = layer.emit(baseInput());
    const suppressed = layer.emit(baseInput({ summary: 'Suppressed duplicate' }));

    expect(suppressed.id).toBe(first.id);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(first, 'emitted');
  });

  it('does not expire signals without expiresAtStep after advanceStep', () => {
    const layer = createLayer();
    const signal = layer.emit(baseInput());

    layer.advanceStep(signal.threadId);

    expect(layer.get(signal.id)?.state).toBe('emitted');
  });

  it('does not expire a signal before its expiresAtStep boundary', () => {
    const layer = createLayer();
    const signal = layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        expiresAtStep: 2,
        summary: 'Not stale yet',
      }),
    );

    layer.advanceStep(signal.threadId);

    expect(layer.get(signal.id)?.state).toBe('emitted');
  });

  it('throws when superseding a signal that is already terminal', () => {
    const layer = createLayer();
    const resolved = layer.emit(baseInput());
    layer.resolve(resolved.id);

    expect(() =>
      layer.emit(
        baseInput({
          signalClass: 'confidence.medium',
          confidence: 0.5,
          summary: 'Cannot replace resolved',
          replaces: resolved.id,
        }),
      ),
    ).toThrowError(ConnectivityError);

    const expiring = layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        expiresAtStep: 1,
        summary: 'Will expire',
      }),
    );
    layer.advanceStep(expiring.threadId);

    expect(() =>
      layer.emit(
        nonConfidenceInput({
          messageClass: 'handoff',
          signalClass: 'handoff.partial',
          audience: 'selected',
          source: 'specialist:planner',
          summary: 'Cannot replace expired',
          replaces: expiring.id,
        }),
      ),
    ).toThrowError(ConnectivityError);
  });
});

describe('callbacks, audience, and routing hook behavior', () => {
  it('fires emitted, superseded, resolved, and expired events in the expected cases', () => {
    const events: Array<{ id: string; event: SignalEvent; state: SignalState }> = [];
    const layer = createLayer();
    const callback = vi.fn((signal, event) => {
      events.push({ id: signal.id, event, state: signal.state });
    });
    layer.onSignal(callback);

    const first = layer.emit(baseInput());
    const second = layer.emit(
      baseInput({
        signalClass: 'confidence.medium',
        confidence: 0.5,
        summary: 'Superseding update',
        replaces: first.id,
      }),
    );
    layer.resolve(second.id);
    layer.emit(
      baseInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        confidence: undefined,
        summary: 'Expiring note',
        expiresAtStep: 1,
      }),
    );
    layer.advanceStep('thread-1');
    layer.offSignal(callback);
    layer.emit(
      baseInput({
        summary: 'No callback after offSignal',
      }),
    );

    expect(callback).toHaveBeenCalled();
    expect(events.map((item) => item.event)).toContain('emitted');
    expect(events.map((item) => item.event)).toContain('superseded');
    expect(events.map((item) => item.event)).toContain('resolved');
    expect(events.map((item) => item.event)).toContain('expired');
  });

  it('continues firing callbacks when one callback throws', () => {
    const layer = createLayer();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();

    layer.onSignal(first);
    layer.onSignal(second);
    layer.emit(baseInput());

    expect(errorSpy).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('calls the selected audience resolver for narrowcast attention and exposes the first workflow', () => {
    const layer = createLayer();
    const resolver = vi.fn(() => ['specialist:writer']);
    const callback = vi.fn();
    layer.registerSelectedResolver(resolver);
    layer.onSignal(callback);

    const signal = layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        audience: 'selected',
        summary: 'Memory found a user-specific constraint',
      }),
    );

    expect(resolver).toHaveBeenCalledWith(signal);
    expect(callback).toHaveBeenCalledWith(signal, 'emitted');
    expect(layer.query({ threadId: 'thread-1', messageClass: 'attention' })).toHaveLength(1);
    expect(layer.resolve(signal.id).state).toBe('resolved');
  });

  it('supports reviewer conflict and specialist handoff workflows', () => {
    const layer = createLayer();

    const conflictA = layer.emit(
      baseInput({
        source: 'specialist:reviewer-a',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.8,
        summary: 'Reviewer A found a factual conflict',
      }),
    );
    const conflictB = layer.emit(
      baseInput({
        source: 'specialist:reviewer-b',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.7,
        summary: 'Reviewer B found a policy conflict',
      }),
    );
    const handoff = layer.emit(
      nonConfidenceInput({
        source: 'specialist:planner',
        messageClass: 'handoff',
        signalClass: 'handoff.ready',
        audience: 'selected',
        summary: 'The plan is ready for execution review',
      }),
    );

    expect(
      layer.query({
        threadId: 'thread-1',
        messageClass: 'conflict',
      }).map((item) => item.id).sort(),
    ).toEqual([conflictA.id, conflictB.id].sort());
    expect(handoff.signalClass).toBe('handoff.ready');
    expect(layer.resolve(conflictA.id).state).toBe('resolved');
  });

  it('calls the routing escalation hook for escalation workflow signals and does not let hook failures block callbacks', () => {
    const callback = vi.fn();
    const hook = {
      onEscalation: vi.fn()
        .mockReturnValueOnce('deep')
        .mockImplementationOnce(() => {
          throw new Error('hook failure');
        }),
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layer = createConnectivityLayer({
      routingEscalationHook: hook,
    });
    layer.onSignal(callback);

    const uncertainty = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.uncertainty',
        priority: 'high',
        summary: 'Current mode cannot resolve blocker uncertainty',
      }),
    );
    const interrupt = layer.emit(
      nonConfidenceInput({
        messageClass: 'escalation',
        signalClass: 'escalation.interrupt',
        priority: 'critical',
        summary: 'Immediate path change required',
      }),
    );
    layer.emit(baseInput({ summary: 'Not an escalation hook call' }));

    expect(hook.onEscalation).toHaveBeenCalledTimes(2);
    expect(hook.onEscalation).toHaveBeenNthCalledWith(1, uncertainty);
    expect(hook.onEscalation).toHaveBeenNthCalledWith(2, interrupt);
    expect(callback).toHaveBeenCalledWith(uncertainty, 'emitted');
    expect(callback).toHaveBeenCalledWith(interrupt, 'emitted');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not call the selected audience resolver for self audience', () => {
    const layer = createLayer();
    const resolver = vi.fn(() => ['specialist:writer']);
    layer.registerSelectedResolver(resolver);

    layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        audience: 'self',
        summary: 'Only the emitter should receive this',
      }),
    );

    expect(resolver).not.toHaveBeenCalled();
  });

  it('supports all-audience emits across multiple thread sources', () => {
    const layer = createLayer();
    const callback = vi.fn();
    layer.onSignal(callback);

    layer.emit(baseInput());
    layer.emit(
      baseInput({
        source: 'specialist:reviewer-b',
        signalClass: 'confidence.medium',
        confidence: 0.6,
        summary: 'Second source present',
      }),
    );
    const broadcast = layer.emit(
      nonConfidenceInput({
        source: 'specialist:planner',
        audience: 'all',
        messageClass: 'handoff',
        signalClass: 'handoff.partial',
        summary: 'Broadcasting partial handoff context',
      }),
    );

    expect(callback).toHaveBeenCalledWith(broadcast, 'emitted');
    expect(
      new Set(layer.query({ threadId: 'thread-1' }).map((signal) => signal.source)),
    ).toEqual(
      new Set([
        'specialist:reviewer',
        'specialist:reviewer-b',
        'specialist:planner',
      ]),
    );
  });

  it('allows selected-audience emits when no resolver is registered', () => {
    const layer = createLayer();

    expect(() =>
      layer.emit(
        nonConfidenceInput({
          messageClass: 'handoff',
          signalClass: 'handoff.ready',
          audience: 'selected',
          source: 'specialist:planner',
          summary: 'Resolver is optional',
        }),
      ),
    ).not.toThrow();
  });

  it('replaces the selected audience resolver when a new one is registered', () => {
    const layer = createLayer();
    const resolverA = vi.fn(() => ['specialist:a']);
    const resolverB = vi.fn(() => ['specialist:b']);

    layer.registerSelectedResolver(resolverA);
    layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        audience: 'selected',
        summary: 'First resolver',
      }),
    );
    layer.registerSelectedResolver(resolverB);
    layer.emit(
      nonConfidenceInput({
        messageClass: 'attention',
        signalClass: 'attention.raise',
        audience: 'selected',
        source: 'specialist:reviewer-b',
        summary: 'Second resolver',
      }),
    );

    expect(resolverA).toHaveBeenCalledTimes(1);
    expect(resolverB).toHaveBeenCalledTimes(1);
  });

  it('keeps a signal resolved when a callback resolves it during emitted delivery', () => {
    const layer = createLayer();
    let emittedId = '';

    layer.onSignal((signal, event) => {
      if (event === 'emitted') {
        emittedId = signal.id;
        layer.resolve(signal.id);
      }
    });

    const signal = layer.emit(baseInput());

    expect(emittedId).toBe(signal.id);
    expect(signal.state).toBe('resolved');
    expect(layer.get(signal.id)?.state).toBe('resolved');
  });

  it('clears both active conflict signals from the default query once resolved', () => {
    const layer = createLayer();
    const conflictA = layer.emit(
      baseInput({
        source: 'specialist:reviewer-a',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.8,
        summary: 'Conflict A',
      }),
    );
    const conflictB = layer.emit(
      baseInput({
        source: 'specialist:reviewer-b',
        messageClass: 'conflict',
        signalClass: 'conflict.active',
        priority: 'high',
        confidence: 0.7,
        summary: 'Conflict B',
      }),
    );

    layer.resolve(conflictA.id);
    layer.resolve(conflictB.id);

    expect(
      layer.query({
        threadId: 'thread-1',
        messageClass: 'conflict',
      }),
    ).toEqual([]);
  });

  it('supersedes handoff.partial with handoff.ready in the handoff workflow', () => {
    const layer = createLayer();

    const partial = layer.emit(
      nonConfidenceInput({
        source: 'specialist:planner',
        audience: 'selected',
        messageClass: 'handoff',
        signalClass: 'handoff.partial',
        summary: 'Partial handoff context',
      }),
    );
    const ready = layer.emit(
      nonConfidenceInput({
        source: 'specialist:planner',
        audience: 'selected',
        messageClass: 'handoff',
        signalClass: 'handoff.ready',
        summary: 'Ready handoff context',
        replaces: partial.id,
      }),
    );

    expect(layer.get(partial.id)?.state).toBe('superseded');
    expect(['emitted', 'active']).toContain(ready.state);
    expect(
      layer.query({
        threadId: 'thread-1',
        messageClass: 'handoff',
      }).map((signal) => signal.id),
    ).toEqual([ready.id]);
  });
});
