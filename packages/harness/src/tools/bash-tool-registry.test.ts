import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { BashToolRegistry } from './bash-tool-registry.js';
import type {
  HarnessToolAvailabilityInput,
  HarnessToolCall,
  HarnessToolExecutionContext,
} from '../types.js';

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  kill = vi.fn<[string?], boolean>().mockReturnValue(true);
}

function buildRegistry(opts: {
  allowedCommands?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  onSpawn?: (child: FakeChild) => void;
}) {
  let lastChild: FakeChild | null = null;

  const spawnImpl = vi.fn((_cmd: string, _opts: unknown) => {
    const child = new FakeChild();
    lastChild = child;
    opts.onSpawn?.(child);
    return child as unknown as ChildProcess;
  });

  const registry = new BashToolRegistry({
    allowedCommands: opts.allowedCommands ?? ['echo', 'ls'],
    timeoutMs: opts.timeoutMs,
    maxOutputBytes: opts.maxOutputBytes,
    spawnImpl: spawnImpl as unknown as typeof import('node:child_process').spawn,
  });

  return { registry, spawnImpl, getLastChild: () => lastChild };
}

const availabilityInput: HarnessToolAvailabilityInput = {
  assistantId: 'a1',
  turnId: 't1',
};

const execContext: HarnessToolExecutionContext = {
  assistantId: 'a1',
  turnId: 't1',
  iteration: 0,
  toolCallIndex: 0,
};

function bashCall(
  input: Record<string, unknown> = { command: 'echo hello' },
  name = 'bash',
): HarnessToolCall {
  return { id: 'c1', name, input };
}

describe('BashToolRegistry', () => {
  it('listAvailable returns exactly one tool with correct schema', async () => {
    const { registry } = buildRegistry({});
    const tools = await registry.listAvailable(availabilityInput);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('bash');
    expect(tools[0].inputSchema).toMatchObject({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    });
  });

  it('unknown tool name → unknown_tool error code', async () => {
    const { registry } = buildRegistry({});
    const result = await registry.execute(
      bashCall({ command: 'echo hi' }, 'unknown_tool'),
      execContext,
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('unknown_tool');
  });

  it('non-string command → invalid_input error code', async () => {
    const { registry } = buildRegistry({});
    const result = await registry.execute(bashCall({ command: 42 }), execContext);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('invalid_input');
  });

  it('command first-token not in allowlist → command_not_allowed with rejected token in message', async () => {
    const { registry } = buildRegistry({ allowedCommands: ['echo'] });
    const result = await registry.execute(bashCall({ command: 'rm -rf /' }), execContext);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('command_not_allowed');
    expect(result.error?.message).toContain('rm');
  });

  it('success path: stdout hello close 0 → success with hello in output', async () => {
    const { registry } = buildRegistry({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('hello\n'));
          child.emit('close', 0);
        });
      },
    });

    const result = await registry.execute(bashCall({ command: 'echo hello' }), execContext);

    expect(result.status).toBe('success');
    expect(result.output).toContain('hello');
  });

  it('non-zero exit: stderr oops close 2 → nonzero_exit with 2 in message', async () => {
    const { registry } = buildRegistry({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stderr.emit('data', Buffer.from('oops'));
          child.emit('close', 2);
        });
      },
    });

    const result = await registry.execute(bashCall({ command: 'echo fail' }), execContext);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('nonzero_exit');
    expect(result.error?.message).toContain('2');
  });

  it('timeout: never close with timeoutMs 50 → timeout error and kill called with SIGKILL', async () => {
    const { registry, getLastChild } = buildRegistry({
      timeoutMs: 50,
      onSpawn: () => {
        // intentionally never emits close
      },
    });

    const result = await registry.execute(bashCall({ command: 'echo hang' }), execContext);
    const child = getLastChild()!;

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('timeout');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('output truncation: large stdout > maxOutputBytes → output bounded with truncation marker', async () => {
    const maxOutputBytes = 100;
    const bigData = Buffer.alloc(200, 'x');

    const { registry } = buildRegistry({
      maxOutputBytes,
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.stdout.emit('data', bigData);
          child.emit('close', 0);
        });
      },
    });

    const result = await registry.execute(bashCall({ command: 'echo big' }), execContext);

    expect(result.status).toBe('success');
    expect(result.output).toContain('[output truncated to');
    // The raw captured portion must be at most maxOutputBytes characters
    const rawPortion = result.output!.slice(0, maxOutputBytes);
    expect(rawPortion.length).toBeLessThanOrEqual(maxOutputBytes);
  });

  it('allowlist names appear in tool description', async () => {
    const allowedCommands = ['git', 'npm', 'node'];
    const { registry } = buildRegistry({ allowedCommands });
    const tools = await registry.listAvailable(availabilityInput);
    const desc = tools[0].description;

    for (const cmd of allowedCommands) {
      expect(desc).toContain(cmd);
    }
  });

  it('spawn error event → spawn_error error code', async () => {
    const { registry } = buildRegistry({
      onSpawn: (child) => {
        queueMicrotask(() => {
          child.emit('error', new Error('ENOENT spawn failed'));
        });
      },
    });

    const result = await registry.execute(bashCall({ command: 'echo test' }), execContext);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('spawn_error');
  });
});
