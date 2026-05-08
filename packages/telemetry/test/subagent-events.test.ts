import { describe, expect, it } from 'vitest';

import {
  createSubagentBatchStartedEvent,
  createSubagentFailedEvent,
  createSubagentFinishedEvent,
  createSubagentStartedEvent,
} from '../src/events.js';

describe('subagent telemetry events', () => {
  it('returns frozen, schema-stable payloads for subagent lifecycle events', () => {
    const started = createSubagentStartedEvent(
      {
        timestamp: '2026-05-07T12:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-1',
        parentTraceId: 'trace-parent',
        childTraceId: 'trace-parent.sa-1',
        subagentName: 'repo-reader',
        toolCallCount: 0,
      },
      { generateEventId: () => 'event-started' },
    );
    const finished = createSubagentFinishedEvent(
      {
        timestamp: '2026-05-07T12:00:05.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-1',
        parentTraceId: 'trace-parent',
        childTraceId: 'trace-parent.sa-1',
        subagentName: 'repo-reader',
        iterations: 2,
        stopReason: 'answer_finalized',
        toolCallCount: 3,
        durationMs: 5000,
      },
      { generateEventId: () => 'event-finished' },
    );
    const failed = createSubagentFailedEvent(
      {
        timestamp: '2026-05-07T12:00:06.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1.sa-2',
        parentTraceId: 'trace-parent',
        childTraceId: 'trace-parent.sa-2',
        subagentName: 'repo-writer',
        iterations: 1,
        stopReason: 'runtime_error',
        toolCallCount: 1,
      },
      { generateEventId: () => 'event-failed' },
    );
    const batch = createSubagentBatchStartedEvent(
      {
        timestamp: '2026-05-07T12:00:00.000Z',
        assistantId: 'assistant-1',
        turnId: 'turn-1',
        parentTraceId: 'trace-parent',
        subagentNames: ['repo-reader', 'repo-writer'],
        childTraceIds: ['trace-parent.sa-1', 'trace-parent.sa-2'],
      },
      { generateEventId: () => 'event-batch' },
    );

    expect(started).toEqual({
      eventId: 'event-started',
      eventKind: 'subagent.started',
      timestamp: '2026-05-07T12:00:00.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1.sa-1',
      parentTraceId: 'trace-parent',
      childTraceId: 'trace-parent.sa-1',
      subagentName: 'repo-reader',
      toolCallCount: 0,
    });
    expect(finished).toEqual({
      eventId: 'event-finished',
      eventKind: 'subagent.finished',
      timestamp: '2026-05-07T12:00:05.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1.sa-1',
      parentTraceId: 'trace-parent',
      childTraceId: 'trace-parent.sa-1',
      subagentName: 'repo-reader',
      iterations: 2,
      stopReason: 'answer_finalized',
      toolCallCount: 3,
      durationMs: 5000,
    });
    expect(failed).toEqual({
      eventId: 'event-failed',
      eventKind: 'subagent.failed',
      timestamp: '2026-05-07T12:00:06.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1.sa-2',
      parentTraceId: 'trace-parent',
      childTraceId: 'trace-parent.sa-2',
      subagentName: 'repo-writer',
      iterations: 1,
      stopReason: 'runtime_error',
      toolCallCount: 1,
    });
    expect(batch).toEqual({
      eventId: 'event-batch',
      eventKind: 'subagent.batch.started',
      timestamp: '2026-05-07T12:00:00.000Z',
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      parentTraceId: 'trace-parent',
      subagentNames: ['repo-reader', 'repo-writer'],
      childTraceIds: ['trace-parent.sa-1', 'trace-parent.sa-2'],
      batchSize: 2,
    });

    expect(Object.isFrozen(started)).toBe(true);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.subagentNames)).toBe(true);
    expect(Object.isFrozen(batch.childTraceIds)).toBe(true);
  });

  it('rejects oversize payloads at construction time', () => {
    expect(() =>
      createSubagentStartedEvent(
        {
          timestamp: '2026-05-07T12:00:00.000Z',
          assistantId: 'assistant-1',
          turnId: 'turn-1.sa-1',
          parentTraceId: 'trace-parent',
          childTraceId: 'trace-parent.sa-1',
          subagentName: 'repo-reader',
        },
        {
          generateEventId: () => 'event-started',
          maxPayloadBytes: 64,
        },
      ),
    ).toThrow(/exceeds max 64 bytes/u);
  });
});
