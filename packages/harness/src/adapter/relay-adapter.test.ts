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

  it('starts the broker on the configured channels', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x', channels: ['wf-custom'] });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash' });
    driver.state.release?.();
    await expect(spawned).resolves.toMatchObject({ success: true, name: 'Worker' });

    expect(driver.spawn).toHaveBeenCalledWith(expect.objectContaining({ channels: ['wf-custom'] }));
  });

  it('spawns agents on general by default (sdk 6.x parity)', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x', channels: ['wf-custom'] });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash' });
    driver.state.release?.();
    await spawned;

    expect(driver.client.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({ channels: ['general'] }),
    );
  });

  it('spawns agents on explicitly requested channels', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash', channels: ['wf-custom'] });
    driver.state.release?.();
    await spawned;

    expect(driver.client.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Worker', channels: ['wf-custom'] }),
    );
  });

  it('returns a failed spawn/release result when the broker cannot start', async () => {
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const spawned = relay.spawn({ name: 'Worker', cli: 'bash' });
    driver.state.fail?.(new Error('broker boom'));
    await expect(spawned).resolves.toEqual({ success: false, name: 'Worker', error: 'broker boom' });

    const released = relay.release('Worker');
    await vi.waitFor(() => expect(driver.spawn).toHaveBeenCalledTimes(2));
    driver.state.fail?.(new Error('broker boom again'));
    await expect(released).resolves.toEqual({
      success: false,
      name: 'Worker',
      error: 'broker boom again',
    });
  });

  it('tracks each onEvent registration independently, across start()', async () => {
    const detachA = vi.fn();
    const detachB = vi.fn();
    driver.client.onEvent.mockReturnValueOnce(detachA).mockReturnValueOnce(detachB);
    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const listener = vi.fn();
    const offA = relay.onEvent(listener);
    const offB = relay.onEvent(listener);

    const started = relay.start();
    driver.state.release?.();
    await started;
    expect(driver.client.onEvent).toHaveBeenCalledTimes(2);

    offA();
    expect(detachA).toHaveBeenCalledTimes(1);
    expect(detachB).not.toHaveBeenCalled();
    offA();
    expect(detachA).toHaveBeenCalledTimes(1);
    offB();
    expect(detachB).toHaveBeenCalledTimes(1);
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

  it('does not signal the broker when graceful shutdown completes in time', async () => {
    driver.client.brokerPid = 424243;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const relay = new RelayAdapter({ cwd: '/tmp/x' });
    const started = relay.start();
    driver.state.release?.();
    await started;
    await relay.shutdown();

    expect(driver.client.shutdown).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(driver.client.disconnect).not.toHaveBeenCalled();
  });
});

describe('AgentRelayExecutionAdapter with the default RelayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins an auto-spawned worker to the channel when requests target the channel', async () => {
    const spawn = vi.fn(async (req: { name: string }) => ({ success: true, name: req.name }));
    const adapter = createAgentRelayExecutionAdapter({
      channelId: 'wf-test',
      timeoutMs: 20,
      spawnWorker: { enabled: true, name: 'Worker', cli: 'bash' },
      relay: {
        start: async () => {},
        sendMessage: async () => ({ event_id: 'e1', targets: [] }),
        onEvent: () => () => {},
        listAgents: async () => [],
        spawn,
      },
    });
    await adapter.execute({
      assistantId: 'a',
      turnId: 'turn-ch',
      message: { id: 'm', text: 'hi', receivedAt: new Date().toISOString() },
      instructions: { systemPrompt: 'sys' },
    });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Worker', channels: ['wf-test'] }));
  });

  it('keeps a named auto-spawned worker on its default channel', async () => {
    const spawn = vi.fn(async (req: { name: string }) => ({ success: true, name: req.name }));
    const adapter = createAgentRelayExecutionAdapter({
      channelId: 'wf-test',
      workerName: 'Worker',
      timeoutMs: 20,
      spawnWorker: { enabled: true, cli: 'bash' },
      relay: {
        start: async () => {},
        sendMessage: async () => ({ event_id: 'e1', targets: [] }),
        onEvent: () => () => {},
        listAgents: async () => [],
        spawn,
      },
    });
    await adapter.execute({
      assistantId: 'a',
      turnId: 'turn-named',
      message: { id: 'm', text: 'hi', receivedAt: new Date().toISOString() },
      instructions: { systemPrompt: 'sys' },
    });
    expect(spawn.mock.calls[0]?.[0]).not.toHaveProperty('channels');
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
