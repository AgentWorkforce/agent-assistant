import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driver = vi.hoisted(() => {
  const client = {
    brokerPid: undefined as number | undefined,
    onEvent: vi.fn(() => () => {}),
    spawnPty: vi.fn(async (input: { name: string }) => ({ name: input.name })),
    listAgents: vi.fn(async () => [] as Array<{ name: string; pid?: number }>),
    shutdown: vi.fn(async () => {}),
    disconnect: vi.fn(),
  };
  const state: { release?: () => void; fail?: (err: Error) => void } = {};
  const spawn = vi.fn(
    (_opts: unknown) =>
      new Promise<typeof client>((resolve, reject) => {
        state.release = () => resolve(client);
        state.fail = reject;
      }),
  );
  return { client, spawn, state };
});

vi.mock('@agent-relay/harness-driver', () => ({
  HarnessDriverClient: { spawn: driver.spawn },
}));

import { createAgentRelayExecutionAdapter } from './agent-relay-adapter.js';
import { RelayAdapter } from './relay-adapter.js';

describe('RelayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driver.client.brokerPid = undefined;
    driver.client.shutdown.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes spawned agents to the configured channels', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x', channels: ['wf-custom'] });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash' });
    driver.state.release?.();
    await expect(spawned).resolves.toMatchObject({ success: true, name: 'Worker' });

    expect(driver.spawn).toHaveBeenCalledWith(expect.objectContaining({ channels: ['wf-custom'] }));
    expect(driver.client.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Worker', channels: ['wf-custom'] }),
    );
  });

  it('defaults spawned agents to the general channel', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash' });
    driver.state.release?.();
    await spawned;

    expect(driver.client.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({ channels: ['general'] }),
    );
  });

  it('treats shutdown() before start() as a no-op', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    await expect(relay.shutdown()).resolves.toBeUndefined();
    expect(driver.spawn).not.toHaveBeenCalled();
  });

  it('treats shutdown() after a failed start() as a no-op', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const started = relay.start();
    driver.state.fail?.(new Error('broker boom'));
    await expect(started).rejects.toThrow('broker boom');
    await expect(relay.shutdown()).resolves.toBeUndefined();
    expect(driver.client.shutdown).not.toHaveBeenCalled();
  });

  it('waits for an in-flight start() and then shuts the broker down', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const started = relay.start();
    const stopped = relay.shutdown();
    driver.state.release?.();

    await started;
    await expect(stopped).resolves.toBeUndefined();
    expect(driver.client.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shares one shutdown between concurrent callers and is idempotent', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const started = relay.start();
    driver.state.release?.();
    await started;

    await Promise.all([relay.shutdown(), relay.shutdown()]);
    await relay.shutdown();
    expect(driver.client.shutdown).toHaveBeenCalledTimes(1);
  });

  it('bounds a hanging shutdown and SIGKILLs the broker process', async () => {
    driver.client.brokerPid = 424242;
    driver.client.shutdown.mockImplementation(() => new Promise<void>(() => {}));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const relay = new RelayAdapter({ cwd: '/tmp/x', shutdownTimeoutMs: 20 });
    const started = relay.start();
    driver.state.release?.();
    await started;

    await expect(relay.shutdown()).resolves.toBeUndefined();
    expect(driver.client.disconnect).toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(424242, 0);
    expect(kill).toHaveBeenCalledWith(424242, 'SIGKILL');
  });

  it('does not kill a broker that already exited after graceful shutdown', async () => {
    driver.client.brokerPid = 424243;
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true;
    });

    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const started = relay.start();
    driver.state.release?.();
    await started;
    await relay.shutdown();

    expect(driver.client.shutdown).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalledWith(424243, 'SIGKILL');
  });
});

describe('AgentRelayExecutionAdapter with the default RelayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a typed failure when the broker fails to start and shutdownAfterExecute is set', async () => {
    const adapter = createAgentRelayExecutionAdapter({
      cwd: '/tmp/x',
      channelId: 'wf-test',
      workerName: 'Worker',
      shutdownAfterExecute: true,
      timeoutMs: 1_000,
    });

    const pending = adapter.execute({
      assistantId: 'a',
      turnId: 'turn-1',
      message: { id: 'm-1', text: 'hi', receivedAt: new Date().toISOString() },
      instructions: { systemPrompt: 'sys' },
    });
    await vi.waitFor(() => expect(driver.spawn).toHaveBeenCalled());
    driver.state.fail?.(new Error('broker failed to boot'));

    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('backend_execution_error');
    expect(result.error?.message).toContain('broker failed to boot');
  });
});
