import { describe, expect, it } from 'vitest';

import {
  createRuntimePolicyBlockedEvent,
  createRuntimePolicyCacheHitEvent,
  createRuntimePolicyOutputSanitizedEvent,
  createSubagentBatchStartedEvent,
  createSubagentFailedEvent,
  createSubagentFinishedEvent,
  createSubagentStartedEvent,
  createSynthesisSalvagedEvent,
} from '../src/events.js';
import { InMemoryTelemetrySink } from '../src/sinks/memory.js';

describe('runtime policy telemetry events', () => {
  it('returns frozen, schema-stable runtime policy payloads', () => {
    const blocked = createRuntimePolicyBlockedEvent(
      {
        timestamp: '2026-05-07T13:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        parentTraceId: 'trace-parent',
        toolName: 'search',
        reason: 'reserve_floor_reached',
        metadata: {
          floor: 2,
          categories: ['broad'],
        },
      },
      { generateEventId: () => 'event-blocked' },
    );
    const cacheHit = createRuntimePolicyCacheHitEvent(
      {
        timestamp: '2026-05-07T13:00:01.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        toolName: 'search',
        reason: 'duplicate_tool_call_cached',
        metadata: {
          cached: true,
        },
      },
      { generateEventId: () => 'event-cache' },
    );
    const sanitized = createRuntimePolicyOutputSanitizedEvent(
      {
        timestamp: '2026-05-07T13:00:02.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'pseudo_tool_syntax_removed',
        metadata: {
          strippedTokenClasses: ['pseudo_tool_fence', 'invoke'],
        },
      },
      { generateEventId: () => 'event-sanitized' },
    );
    const salvaged = createSynthesisSalvagedEvent(
      {
        timestamp: '2026-05-07T13:00:03.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'completed_after_runtime_policy_intervention',
        metadata: {
          blockedCalls: 1,
          cacheHits: 2,
          sanitizerHits: 1,
        },
      },
      { generateEventId: () => 'event-salvaged' },
    );

    expect(blocked).toEqual({
      eventId: 'event-blocked',
      eventKind: 'runtime_policy.blocked',
      timestamp: '2026-05-07T13:00:00.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      parentTraceId: 'trace-parent',
      toolName: 'search',
      reason: 'reserve_floor_reached',
      metadata: {
        floor: 2,
        categories: ['broad'],
      },
    });
    expect(cacheHit).toEqual({
      eventId: 'event-cache',
      eventKind: 'runtime_policy.cache_hit',
      timestamp: '2026-05-07T13:00:01.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      toolName: 'search',
      reason: 'duplicate_tool_call_cached',
      metadata: {
        cached: true,
      },
    });
    expect(sanitized).toEqual({
      eventId: 'event-sanitized',
      eventKind: 'runtime_policy.output_sanitized',
      timestamp: '2026-05-07T13:00:02.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      reason: 'pseudo_tool_syntax_removed',
      metadata: {
        strippedTokenClasses: ['pseudo_tool_fence', 'invoke'],
      },
    });
    expect(salvaged).toEqual({
      eventId: 'event-salvaged',
      eventKind: 'synthesis.salvaged',
      timestamp: '2026-05-07T13:00:03.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      reason: 'completed_after_runtime_policy_intervention',
      metadata: {
        blockedCalls: 1,
        cacheHits: 2,
        sanitizerHits: 1,
      },
    });

    expect(Object.isFrozen(blocked)).toBe(true);
    expect(Object.isFrozen(blocked.metadata)).toBe(true);
  });

  it('round-trips every new event kind through the in-memory sink', () => {
    const sink = new InMemoryTelemetrySink();
    const events = [
      createSubagentBatchStartedEvent({
        timestamp: '2026-05-07T13:10:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        subagentNames: ['reader'],
        childTraceIds: ['trace-parent.sa-1'],
      }),
      createSubagentStartedEvent({
        timestamp: '2026-05-07T13:10:01.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-1',
        subagentName: 'reader',
        childTraceId: 'trace-parent.sa-1',
      }),
      createSubagentFinishedEvent({
        timestamp: '2026-05-07T13:10:02.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-1',
        subagentName: 'reader',
        childTraceId: 'trace-parent.sa-1',
      }),
      createSubagentFailedEvent({
        timestamp: '2026-05-07T13:10:03.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-2',
        subagentName: 'writer',
        childTraceId: 'trace-parent.sa-2',
        stopReason: 'runtime_error',
      }),
      createRuntimePolicyBlockedEvent({
        timestamp: '2026-05-07T13:10:04.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'reserve_floor_reached',
      }),
      createRuntimePolicyCacheHitEvent({
        timestamp: '2026-05-07T13:10:05.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'duplicate_tool_call_cached',
      }),
      createRuntimePolicyOutputSanitizedEvent({
        timestamp: '2026-05-07T13:10:06.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'pseudo_tool_syntax_removed',
      }),
      createSynthesisSalvagedEvent({
        timestamp: '2026-05-07T13:10:07.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        reason: 'completed_after_runtime_policy_intervention',
      }),
    ];

    for (const event of events) {
      sink.emit(event);
    }

    expect(sink.events()).toEqual(events);
  });
});
