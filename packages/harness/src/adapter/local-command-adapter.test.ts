import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { LocalCommandExecutionAdapter } from './local-command-adapter.js';
import type {
  ExecutionCapabilities,
  ExecutionRequest,
} from './types.js';

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

const CAPABILITIES: ExecutionCapabilities = {
  toolUse: 'adapter-mediated',
  structuredToolCalls: true,
  continuationSupport: 'none',
  approvalInterrupts: 'none',
  traceDepth: 'minimal',
  attachments: false,
  maxContextStrategy: 'medium',
  notes: ['test local command'],
};

function baseRequest(): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Summarize the local command proof',
      receivedAt: '2026-04-20T12:00:00.000Z',
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
          text: 'Only generic local commands are in scope.',
          category: 'workspace',
        },
      ],
    },
  };
}

function createAdapter(options: {
  capabilities?: ExecutionCapabilities;
  onSpawn?: (child: MockChild, args: string[], request: ExecutionRequest) => void;
  timeoutMs?: number;
}) {
  let lastRequest: ExecutionRequest | undefined;
  const adapter = new LocalCommandExecutionAdapter({
    backendId: 'fake-local-command',
    command: 'fake-command',
    capabilities: options.capabilities ?? CAPABILITIES,
    timeoutMs: options.timeoutMs ?? 50,
    buildArgs: (request) => {
      lastRequest = request;
      return [
        '--message',
        request.message.text,
        '--tools',
        (request.tools ?? []).map((tool) => tool.name).join(','),
      ];
    },
    parseOutput: (stdout) => {
      const parsed = JSON.parse(stdout) as {
        text?: string;
        structured?: Record<string, unknown>;
        toolCalls?: unknown[];
      };
      return parsed;
    },
    spawnProcess: (_command, args) => {
      const child = new MockChild();
      options.onSpawn?.(child, args, lastRequest ?? baseRequest());
      return child;
    },
  });

  return adapter;
}

describe('LocalCommandExecutionAdapter', () => {
  it('describes declared command capabilities without sharing mutable notes', () => {
    const adapter = createAdapter({});
    const first = adapter.describeCapabilities();
    first.notes?.push('mutated');

    expect(adapter.describeCapabilities().notes).toEqual(['test local command']);
  });

  it('executes a successful local command response', async () => {
    const adapter = createAdapter({
      onSpawn: (child, args) => {
        expect(args).toContain('--message');
        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            JSON.stringify({
              text: 'Proof complete.',
              structured: { backend: 'fake' },
            }),
          );
          child.emit('close', 0, null);
        });
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('completed');
    expect(result.backendId).toBe('fake-local-command');
    expect(result.output?.text).toBe('Proof complete.');
    expect(result.output?.structured).toEqual({ backend: 'fake' });
  });

  it('passes tool descriptors into buildArgs and preserves parsed tool calls', async () => {
    const adapter = createAdapter({
      onSpawn: (child, args, request) => {
        expect(args).toContain('relay_lookup');
        expect(request.tools?.[0]?.description).toBe('Lookup relay evidence');
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
      tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
    });

    expect(result.status).toBe('completed');
    expect(result.output?.structured?.toolCalls).toEqual([{ name: 'relay_lookup', result: 'ok' }]);
    expect(result.trace?.summary.toolCallCount).toBe(1);
  });

  it('maps malformed local output to invalid_backend_output', async () => {
    const adapter = createAdapter({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stdout.emit('data', 'not-json');
          child.emit('close', 0, null);
        });
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('invalid_backend_output');
  });

  it('maps non-zero command exits to failed results', async () => {
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
    expect(result.error?.metadata).toEqual({ stderr: 'permission denied' });
  });

  it('maps command timeouts to retryable timeout failures', async () => {
    const adapter = createAdapter({
      timeoutMs: 5,
      onSpawn: () => {
        // Intentionally never closes.
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.retryable).toBe(true);
  });

  it('reports unsupported and degraded requirements from declared capabilities', () => {
    const adapter = createAdapter({
      capabilities: {
        ...CAPABILITIES,
        toolUse: 'none',
        structuredToolCalls: false,
      },
    });

    const unsupported = adapter.negotiate({
      ...baseRequest(),
      tools: [{ name: 'relay_lookup' }],
    });
    const degraded = adapter.negotiate({
      ...baseRequest(),
      requirements: { structuredToolCalls: 'preferred' },
    });

    expect(unsupported.supported).toBe(false);
    expect(unsupported.reasons[0]?.code).toBe('tool_use_unsupported');
    expect(degraded.supported).toBe(true);
    expect(degraded.degraded).toBe(true);
    expect(degraded.reasons[0]?.code).toBe('structured_tool_calls_unsupported');
  });
});
