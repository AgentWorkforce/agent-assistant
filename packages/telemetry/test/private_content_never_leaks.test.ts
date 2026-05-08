import { describe, expect, it } from 'vitest';
import type { HarnessRuntimePolicyBlockedTraceEvent } from '@agent-assistant/harness';

import {
  createRuntimePolicyBlockedEvent,
  createSynthesisSalvagedEvent,
} from '../src/events.js';
import { telemetryEventsFromTraceEvent } from '../src/harness-bridge.js';

describe('privacy-safe telemetry constructors', () => {
  it.each([
    [{ message: 'provider said hello' }],
    [{ input: 'raw tool input' }],
    [{ output: 'raw tool output' }],
    [{ text: 'verbatim provider text' }],
  ])('rejects forbidden raw-content metadata shapes: %j', (metadata) => {
    expect(() =>
      createRuntimePolicyBlockedEvent({
        timestamp: '2026-05-07T14:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'reserve_floor_reached',
        metadata,
      }),
    ).toThrow(/not allowed/u);
  });

  it('rejects nested object metadata instead of serializing it', () => {
    expect(() =>
      createSynthesisSalvagedEvent({
        timestamp: '2026-05-07T14:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'completed_after_runtime_policy_intervention',
        metadata: {
          nested: { unsafe: true } as never,
        },
      }),
    ).toThrow(/bounded scalar values/u);
  });

  it('strips unsafe metadata keys when bridging from harness trace events', () => {
    const traceEvent: HarnessRuntimePolicyBlockedTraceEvent = {
      type: 'runtime_policy.blocked',
      timestamp: '2026-05-07T14:00:00.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      reason: 'reserve_floor_reached',
      metadata: {
        message: 'private provider content',
        output: 'private tool output',
        floor: 2,
        categories: ['broad'],
      },
    };

    expect(telemetryEventsFromTraceEvent(traceEvent)).toEqual([
      {
        eventId: expect.any(String),
        eventKind: 'runtime_policy.blocked',
        timestamp: '2026-05-07T14:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'reserve_floor_reached',
        metadata: {
          floor: 2,
          categories: ['broad'],
        },
      },
    ]);
  });
});
