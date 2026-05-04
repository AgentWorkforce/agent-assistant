import { describe, expect, it } from 'vitest';

import { BuiltInHarnessAdapter, createBuiltInHarnessAdapter } from './built-in-harness-adapter.js';
import type { ExecutionRequest, ExecutionStreamEvent } from './types.js';
import type {
  HarnessModelAdapter,
  HarnessModelOutput,
  HarnessToolRegistry,
  HarnessToolResult,
} from '../types.js';

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    message: { id: 'msg-1', text: 'Hello', receivedAt: '2026-05-04T00:00:00.000Z' },
    instructions: { systemPrompt: 'Be useful.' },
    ...overrides,
  };
}

function answeringModel(text: string): HarnessModelAdapter {
  return {
    async nextStep(): Promise<HarnessModelOutput> {
      return { type: 'final_answer', text };
    },
  };
}

function toolThenAnswer(): HarnessModelAdapter {
  let step = 0;
  return {
    async nextStep(): Promise<HarnessModelOutput> {
      step += 1;
      if (step === 1) {
        return {
          type: 'tool_request',
          calls: [{ id: 'call-1', name: 'echo', input: { text: 'hi' } }],
        };
      }
      return { type: 'final_answer', text: 'done' };
    },
  };
}

function echoToolRegistry(): HarnessToolRegistry {
  return {
    async listAvailable() {
      return [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }];
    },
    async execute(call): Promise<HarnessToolResult> {
      return { callId: call.id, toolName: call.name, status: 'success', output: JSON.stringify(call.input) };
    },
  };
}

async function collect(stream: AsyncIterable<ExecutionStreamEvent>): Promise<ExecutionStreamEvent[]> {
  const events: ExecutionStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('BuiltInHarnessAdapter', () => {
  it('describes streaming as adapter-mediated by default', () => {
    const adapter = createBuiltInHarnessAdapter({ model: answeringModel('hi') });
    expect(adapter.describeCapabilities().streaming).toBe('adapter-mediated');
  });

  it('execute() returns a completed ExecutionResult with text', async () => {
    const adapter = createBuiltInHarnessAdapter({ model: answeringModel('hello there') });
    const result = await adapter.execute(request());
    expect(result.status).toBe('completed');
    expect(result.output?.text).toBe('hello there');
    expect(result.schemaVersion).toBe(1);
    expect(result.trace?.summary?.stepCount).toBeGreaterThan(0);
  });

  it('executeStreaming() yields at least one text_delta then exactly one turn_finished for a simple text turn', async () => {
    const adapter = new BuiltInHarnessAdapter({ model: answeringModel('streamed') });
    const events = await collect(adapter.executeStreaming!(request()));
    const textDeltas = events.filter((event) => event.type === 'text_delta');
    const turnFinished = events.filter((event) => event.type === 'turn_finished');
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    expect(turnFinished.length).toBe(1);
    expect(turnFinished[0]).toMatchObject({
      type: 'turn_finished',
      result: { status: 'completed', schemaVersion: 1 },
    });
    // The iterable closed after turn_finished — collect() exited cleanly.
    const lastIndex = events.indexOf(turnFinished[0]);
    expect(lastIndex).toBe(events.length - 1);
  });

  it('executeStreaming() turn_finished result equals execute() result modulo timestamps', async () => {
    const a = new BuiltInHarnessAdapter({ model: answeringModel('parity check') });
    const b = new BuiltInHarnessAdapter({ model: answeringModel('parity check') });
    const batchResult = await a.execute(request());
    const events = await collect(b.executeStreaming!(request()));
    const turnFinished = events.find((event) => event.type === 'turn_finished');
    expect(turnFinished).toBeDefined();
    if (turnFinished?.type !== 'turn_finished') return;
    expect(turnFinished.result.status).toBe(batchResult.status);
    expect(turnFinished.result.output?.text).toBe(batchResult.output?.text);
    expect(turnFinished.result.schemaVersion).toBe(batchResult.schemaVersion);
  });

  it('every tool_started in the stream is followed by exactly one tool_finished or tool_failed for the same callId', async () => {
    const adapter = new BuiltInHarnessAdapter({
      model: toolThenAnswer(),
      tools: echoToolRegistry(),
    });
    const events = await collect(adapter.executeStreaming!(request()));
    const startedCalls = events.filter((event) => event.type === 'tool_started').map((event) => (event as { callId: string }).callId);
    expect(startedCalls).toEqual(['call-1']);
    for (const callId of startedCalls) {
      const closers = events.filter(
        (event) =>
          (event.type === 'tool_finished' || event.type === 'tool_failed') &&
          (event as { callId: string }).callId === callId,
      );
      expect(closers).toHaveLength(1);
    }
  });

  it('returns supported:false when streaming is required but capability declares none', () => {
    const adapter = new BuiltInHarnessAdapter({
      model: answeringModel('x'),
      capabilities: {
        schemaVersion: 1,
        toolUse: 'native-iterative',
        structuredToolCalls: true,
        continuationSupport: 'structured',
        approvalInterrupts: 'native',
        traceDepth: 'detailed',
        attachments: false,
        streaming: 'none',
      },
    });
    const negotiation = adapter.negotiate(request({ requirements: { streaming: 'required' } }));
    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons.some((reason) => reason.code === 'other')).toBe(true);
  });

  it('rejects ExecutionRequest with schemaVersion higher than adapter supports', () => {
    const adapter = new BuiltInHarnessAdapter({ model: answeringModel('x') });
    const negotiation = adapter.negotiate(request({ schemaVersion: 999 }));
    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons.find((reason) => reason.code === 'other')?.message).toMatch(/schemaVersion/);
  });
});
