import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenRouterModelAdapter } from './openrouter-model-adapter.js';

// Regression test for the Workers + nodejs_compat + esbuild bare-fetch
// hazard. The prior implementation stored `this.fetchImpl = config.fetchImpl ?? fetch`
// which snapshots `fetch` at construction. Under Workers that snapshot is
// detached from globalThis and first call throws
// "Illegal invocation: function called with incorrect `this` reference".
//
// The fix is a lambda that reads `globalThis.fetch` at call time. This test
// verifies that `vi.stubGlobal("fetch", ...)` is honoured by the default
// fetchImpl — which is only possible if the implementation reads
// globalThis.fetch lazily. A regression back to bare-fetch capture would
// make the stub ineffective on the default adapter and fail this test.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenRouterModelAdapter — workers-fetch regression', () => {
  it('honours vi.stubGlobal("fetch", ...) at call time when no fetchImpl is provided', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'stubbed reply',
                tool_calls: null,
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenRouterModelAdapter({
      apiKey: 'sk-test',
      model: 'anthropic/claude-haiku-4.5',
    });

    const output = await adapter.nextStep({
      assistantId: 'workers-fetch-regression',
      turnId: 't-1',
      message: { id: 'm-1', text: 'ping', receivedAt: '2026-04-24T00:00:00Z' },
      instructions: { systemPrompt: 'You are helpful.' },
      transcript: [],
      availableTools: [],
      iteration: 0,
      toolCallCount: 0,
      elapsedMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(output.type).toBe('final_answer');
  });
});
