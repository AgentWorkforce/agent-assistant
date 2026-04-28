import { describe, expect, it, vi } from 'vitest';

import {
  hashMemoryContent,
  logMemoryOp,
  measureMemoryOp,
} from './observability.js';

describe('observability helpers', () => {
  it('logMemoryOp emits one JSON line via console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logMemoryOp({
      event: 'memory_op',
      op: 'load',
      scope: 'session',
      sessionId: 's1',
      status: 'ok',
      durationMs: 12,
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'memory_op',
        op: 'load',
        scope: 'session',
        sessionId: 's1',
        status: 'ok',
        durationMs: 12,
      }),
    );
  });

  it('measureMemoryOp returns the inner value and logs an ok status', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const inner = vi.fn(async () => 'result');

    await expect(measureMemoryOp({ op: 'save', scope: 'user', userId: 'u1' }, inner)).resolves.toBe(
      'result',
    );

    expect(inner).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[0]))).toMatchObject({
      event: 'memory_op',
      op: 'save',
      scope: 'user',
      userId: 'u1',
      status: 'ok',
    });
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[0])).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('hashes memory content to a deterministic 22-character digest', () => {
    const first = hashMemoryContent('hello world');
    const second = hashMemoryContent('hello world');
    const third = hashMemoryContent('different');

    expect(first).toHaveLength(22);
    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it('logs failed measured operations and rethrows the original error', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const failure = new Error('boom');

    await expect(
      measureMemoryOp({ op: 'load', scope: 'session', sessionId: 's1' }, async () => {
        throw failure;
      }),
    ).rejects.toThrow('boom');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(infoSpy.mock.calls[0]?.[0]))).toMatchObject({
      event: 'memory_op',
      op: 'load',
      status: 'failed',
      error: 'boom',
      scope: 'session',
      sessionId: 's1',
    });
  });
});
