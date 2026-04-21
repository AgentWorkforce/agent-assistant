import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LocalCommandExecutionAdapter } from '../local-command-adapter.js';
import type { ExecutionRequest } from '../types.js';

const fakeHarnessPath = fileURLToPath(new URL('./fixtures/fake-harness.mjs', import.meta.url));

function baseRequest(): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Prove the generic local harness path.',
      receivedAt: '2026-04-20T12:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are Sage.',
      developerPrompt: 'Keep the proof deterministic.',
    },
    context: {
      blocks: [
        {
          id: 'ctx-1',
          label: 'Scope',
          text: 'Use a spawned fake harness process.',
          category: 'workspace',
        },
        {
          id: 'ctx-2',
          label: 'Memory',
          text: 'The local command adapter owns process translation only.',
          category: 'memory',
        },
      ],
    },
    tools: [{ name: 'relay_lookup', description: 'Lookup relay proof evidence' }],
  };
}

describe('LocalCommandExecutionAdapter proof', () => {
  it('executes through a real spawned fake harness command', async () => {
    const adapter = new LocalCommandExecutionAdapter({
      backendId: 'fake-local-harness',
      command: process.execPath,
      capabilities: {
        toolUse: 'adapter-mediated',
        structuredToolCalls: true,
        continuationSupport: 'none',
        approvalInterrupts: 'none',
        traceDepth: 'minimal',
        attachments: false,
        maxContextStrategy: 'medium',
      },
      buildArgs: (request) => [
        fakeHarnessPath,
        request.message.text,
        JSON.stringify({
          assistantId: request.assistantId,
          systemPromptLength: request.instructions.systemPrompt.length,
          contextBlockCount: request.context?.blocks.length ?? 0,
          toolNames: (request.tools ?? []).map((tool) => tool.name),
        }),
      ],
      parseOutput: (stdout) => JSON.parse(stdout) as {
        text: string;
        structured: Record<string, unknown>;
        toolCalls: unknown[];
      },
      timeoutMs: 5_000,
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('completed');
    expect(result.backendId).toBe('fake-local-harness');
    expect(result.output?.text).toBe('fake-harness handled: Prove the generic local harness path.');
    expect(result.output?.structured).toMatchObject({
      assistantId: 'assistant-1',
      systemPromptLength: 'You are Sage.'.length,
      contextBlockCount: 2,
      toolNames: ['relay_lookup'],
      toolCalls: [{ name: 'relay_lookup', result: 'ok' }],
    });
    expect(result.trace?.summary.toolCallCount).toBe(1);
  });
});
