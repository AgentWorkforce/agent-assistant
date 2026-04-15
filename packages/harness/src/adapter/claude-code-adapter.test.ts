import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { ClaudeCodeExecutionAdapter } from './claude-code-adapter.js';
import type { ExecutionRequest } from './types.js';

class MockStream extends EventEmitter {
  setEncoding(): void {}
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('close', null, 'SIGTERM');
    return true;
  }
}

function baseRequest(): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Summarize the proof slice',
      receivedAt: '2026-04-15T12:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are Sage.',
      developerPrompt: 'Be direct.',
    },
    context: {
      blocks: [
        {
          id: 'ctx-1',
          label: 'Scope',
          text: 'Only local BYOH is in scope.',
          category: 'workspace',
        },
      ],
    },
  };
}

function createAdapter(options: {
  onSpawn?: (child: MockChild, args: string[]) => void;
  timeoutMs?: number;
}) {
  return new ClaudeCodeExecutionAdapter({
    timeoutMs: options.timeoutMs ?? 50,
    spawnProcess: (_command, args) => {
      const child = new MockChild();
      options.onSpawn?.(child, args);
      return child;
    },
  });
}

describe('ClaudeCodeExecutionAdapter', () => {
  it('describes the expected bounded capabilities', () => {
    const adapter = createAdapter({});

    expect(adapter.describeCapabilities()).toMatchObject({
      toolUse: 'native-iterative',
      structuredToolCalls: true,
      continuationSupport: 'none',
      approvalInterrupts: 'none',
      traceDepth: 'minimal',
      attachments: false,
      maxContextStrategy: 'large',
    });
  });

  it('rejects required continuation support during negotiation', () => {
    const adapter = createAdapter({});
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      requirements: { continuationSupport: 'required' },
    });

    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons[0]?.code).toBe('continuation_unsupported');
  });

  it('marks preferred approval interrupts as degraded', () => {
    const adapter = createAdapter({});
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      requirements: { approvalInterrupts: 'preferred' },
    });

    expect(negotiation.supported).toBe(true);
    expect(negotiation.degraded).toBe(true);
    expect(negotiation.reasons[0]?.code).toBe('approval_interrupt_unsupported');
  });

  it('rejects required attachments during negotiation', () => {
    const adapter = createAdapter({});
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      requirements: { attachments: 'required' },
    });

    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons[0]?.code).toBe('attachments_unsupported');
  });

  it('maps a completed response without tools', async () => {
    const adapter = createAdapter({
      onSpawn: (child, args) => {
        expect(args).toContain('--system-prompt');
        queueMicrotask(() => {
          child.stdout.emit('data', JSON.stringify({ text: 'Proof complete.' }));
          child.emit('close', 0, null);
        });
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('completed');
    expect(result.output?.text).toBe('Proof complete.');
    expect(result.backendId).toBe('claude-code');
    expect(result.trace?.summary.toolCallCount).toBe(0);
  });

  it('maps a completed response with tool-bearing structured output', async () => {
    const adapter = createAdapter({
      onSpawn: (child, args) => {
        expect(args).toContain('--allowedTools');
        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            JSON.stringify({
              text: 'Used relay lookup.',
              toolCalls: [{ name: 'relay_lookup', result: 'ok' }],
            }),
          );
          child.emit('close', 0, null);
        });
      },
    });

    const result = await adapter.execute({
      ...baseRequest(),
      tools: [{ name: 'relay_lookup', description: 'Lookup proof evidence' }],
    });

    expect(result.status).toBe('completed');
    expect(result.output?.structured?.toolCalls).toEqual([{ name: 'relay_lookup', result: 'ok' }]);
    expect(result.trace?.summary.toolCallCount).toBe(1);
  });

  it('maps non-zero CLI exits to failed results', async () => {
    const adapter = createAdapter({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stderr.emit('data', 'permission denied');
          child.emit('close', 2, null);
        });
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('backend_execution_error');
  });

  it('maps malformed output to invalid_backend_output', async () => {
    const adapter = createAdapter({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stdout.emit('data', 'not json');
          child.emit('close', 0, null);
        });
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('invalid_backend_output');
  });

  it('maps timeouts to failed timeout results', async () => {
    const adapter = createAdapter({
      timeoutMs: 5,
      onSpawn: () => {
        // Intentionally never closes.
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('timeout');
  });
});
