import { describe, expect, it } from 'vitest';

import { createFakeExecutionContext } from './fake-execution-context.js';

describe('createFakeExecutionContext', () => {
  it('resolves pushed promises in order', async () => {
    const fake = createFakeExecutionContext();
    const resolved: number[] = [];

    fake.ctx.waitUntil(Promise.resolve().then(() => resolved.push(1)));
    fake.ctx.waitUntil(Promise.resolve().then(() => resolved.push(2)));

    await fake.settleAll();

    expect(resolved).toEqual([1, 2]);
    expect(fake.pendingCount()).toBe(0);
    expect(fake.settledCount()).toBe(2);
  });

  it('awaits promises registered during settling', async () => {
    const fake = createFakeExecutionContext();
    const resolved: string[] = [];

    fake.ctx.waitUntil(
      Promise.resolve().then(() => {
        resolved.push('first');
        fake.ctx.waitUntil(Promise.resolve().then(() => resolved.push('second')));
      }),
    );

    await fake.settleAll();

    expect(resolved).toEqual(['first', 'second']);
    expect(fake.pendingCount()).toBe(0);
    expect(fake.settledCount()).toBe(2);
  });

  it('surfaces waitUntil promise rejections', async () => {
    const fake = createFakeExecutionContext();
    const error = new Error('boom');

    fake.ctx.waitUntil(Promise.reject(error));

    await expect(fake.settleAll()).rejects.toThrow(error);
  });
});
