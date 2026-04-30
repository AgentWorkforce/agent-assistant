import { describe, expect, it } from 'vitest';

import type { HarnessTurnContext } from './subagent-registry.js';
import { createScratchpadToolRegistry, getOrCreateScratchpadState } from './scratchpad-registry.js';
import type { HarnessToolCall, HarnessToolResult } from './types.js';

function makeContext(overrides: Partial<HarnessTurnContext> = {}): HarnessTurnContext {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    userId: 'user-1',
    threadId: 'thread-1',
    iteration: 0,
    toolCallIndex: 0,
    ...overrides,
  };
}

function makeCall(name: string, input: Record<string, unknown>): HarnessToolCall {
  return {
    id: `${name}-call-1`,
    name,
    input,
  };
}

function createRegistry(options: { maxFileBytes?: number; maxTotalBytes?: number } = {}) {
  return createScratchpadToolRegistry({
    getState: getOrCreateScratchpadState,
    ...options,
  });
}

function parseOutput(result: HarnessToolResult): Record<string, unknown> {
  expect(result.status).toBe('success');
  expect(result.output).toEqual(expect.any(String));
  expect(result.structuredOutput).toEqual(expect.any(Object));

  const parsed = JSON.parse(result.output ?? 'null') as Record<string, unknown>;
  expect(parsed).toEqual(result.structuredOutput);
  return parsed;
}

describe('createScratchpadToolRegistry', () => {
  it('scratch_write creates and scratch_read returns content', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    const writeResult = parseOutput(
      await registry.execute(
        makeCall('scratch_write', { path: 'drafts/plan.txt', content: 'first draft' }),
        ctx,
      ),
    );
    const readResult = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'drafts/plan.txt' }), ctx),
    );

    expect(writeResult).toEqual({
      ok: true,
      path: 'drafts/plan.txt',
      bytes: 11,
    });
    expect(readResult).toEqual({
      ok: true,
      content: 'first draft',
    });
  });

  it('scratch_write enforces maxFileBytes; ok:false; state unchanged', async () => {
    const registry = createRegistry({ maxFileBytes: 5 });
    const ctx = makeContext();
    const state = getOrCreateScratchpadState(ctx);

    const result = parseOutput(
      await registry.execute(
        makeCall('scratch_write', { path: 'big.txt', content: '123456' }),
        ctx,
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: 'File too large: 6 bytes; max 5.',
    });
    expect([...state.files.entries()]).toEqual([]);
  });

  it('scratch_write enforces maxTotalBytes (across all files); ok:false; state unchanged', async () => {
    const registry = createRegistry({ maxTotalBytes: 10 });
    const ctx = makeContext();
    const state = getOrCreateScratchpadState(ctx);

    expect(
      parseOutput(
        await registry.execute(makeCall('scratch_write', { path: 'a.txt', content: '12345' }), ctx),
      ),
    ).toEqual({
      ok: true,
      path: 'a.txt',
      bytes: 5,
    });
    expect(
      parseOutput(
        await registry.execute(makeCall('scratch_write', { path: 'b.txt', content: '67890' }), ctx),
      ),
    ).toEqual({
      ok: true,
      path: 'b.txt',
      bytes: 5,
    });

    const result = parseOutput(
      await registry.execute(makeCall('scratch_write', { path: 'c.txt', content: '!' }), ctx),
    );

    expect(result).toEqual({
      ok: false,
      error: 'Scratchpad full: 11 bytes would exceed max 10.',
    });
    expect([...state.files.entries()]).toEqual([
      ['a.txt', '12345'],
      ['b.txt', '67890'],
    ]);
  });

  it('scratch_list returns sorted paths; prefix filter narrows results', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(makeCall('scratch_write', { path: 'z-last.txt', content: 'z' }), ctx);
    await registry.execute(makeCall('scratch_write', { path: 'notes/b.txt', content: 'b' }), ctx);
    await registry.execute(makeCall('scratch_write', { path: 'notes/a.txt', content: 'a' }), ctx);

    const allPaths = parseOutput(await registry.execute(makeCall('scratch_list', {}), ctx));
    const prefixedPaths = parseOutput(
      await registry.execute(makeCall('scratch_list', { prefix: 'notes/' }), ctx),
    );

    expect(allPaths).toEqual({
      ok: true,
      paths: ['notes/a.txt', 'notes/b.txt', 'z-last.txt'],
    });
    expect(prefixedPaths).toEqual({
      ok: true,
      paths: ['notes/a.txt', 'notes/b.txt'],
    });
  });

  it('scratch_read on missing path returns ok:false with helpful error', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    const result = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'missing.txt' }), ctx),
    );

    expect(result).toEqual({
      ok: false,
      error: 'Not found: missing.txt',
    });
  });

  it('scratch_edit replaces exactly-once; result includes replacements: 1', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(
      makeCall('scratch_write', { path: 'draft.txt', content: 'alpha beta gamma' }),
      ctx,
    );

    const editResult = parseOutput(
      await registry.execute(
        makeCall('scratch_edit', {
          path: 'draft.txt',
          old_string: 'beta',
          new_string: 'BETA',
        }),
        ctx,
      ),
    );
    const readResult = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'draft.txt' }), ctx),
    );

    expect(editResult).toEqual({
      ok: true,
      path: 'draft.txt',
      replacements: 1,
      bytes: 16,
    });
    expect(readResult).toEqual({
      ok: true,
      content: 'alpha BETA gamma',
    });
  });

  it('scratch_edit rejects when old_string occurs 0 times (replace_all=false)', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(makeCall('scratch_write', { path: 'draft.txt', content: 'alpha' }), ctx);

    const result = parseOutput(
      await registry.execute(
        makeCall('scratch_edit', {
          path: 'draft.txt',
          old_string: 'beta',
          new_string: 'BETA',
        }),
        ctx,
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: 'old_string must occur exactly once when replace_all=false (found 0).',
    });
    expect(getOrCreateScratchpadState(ctx).files.get('draft.txt')).toBe('alpha');
  });

  it('scratch_edit rejects when old_string occurs > 1 times (replace_all=false)', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(
      makeCall('scratch_write', { path: 'draft.txt', content: 'beta beta beta' }),
      ctx,
    );

    const result = parseOutput(
      await registry.execute(
        makeCall('scratch_edit', {
          path: 'draft.txt',
          old_string: 'beta',
          new_string: 'BETA',
        }),
        ctx,
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: 'old_string must occur exactly once when replace_all=false (found 3).',
    });
    expect(getOrCreateScratchpadState(ctx).files.get('draft.txt')).toBe('beta beta beta');
  });

  it('scratch_edit replace_all=true replaces every occurrence; result.replacements equals match count', async () => {
    const registry = createRegistry();
    const ctx = makeContext();

    await registry.execute(
      makeCall('scratch_write', { path: 'draft.txt', content: 'ha ha ha' }),
      ctx,
    );

    const editResult = parseOutput(
      await registry.execute(
        makeCall('scratch_edit', {
          path: 'draft.txt',
          old_string: 'ha',
          new_string: 'ho',
          replace_all: true,
        }),
        ctx,
      ),
    );
    const readResult = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'draft.txt' }), ctx),
    );

    expect(editResult).toEqual({
      ok: true,
      path: 'draft.txt',
      replacements: 3,
      bytes: 8,
    });
    expect(readResult).toEqual({
      ok: true,
      content: 'ho ho ho',
    });
  });

  it('scratch_edit post-replace size cap enforcement', async () => {
    const registry = createRegistry({ maxFileBytes: 10 });
    const ctx = makeContext();

    await registry.execute(makeCall('scratch_write', { path: 'draft.txt', content: 'tiny' }), ctx);

    const result = parseOutput(
      await registry.execute(
        makeCall('scratch_edit', {
          path: 'draft.txt',
          old_string: 'tiny',
          new_string: '01234567890',
        }),
        ctx,
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: 'File too large: 11 bytes; max 10.',
    });
    expect(getOrCreateScratchpadState(ctx).files.get('draft.txt')).toBe('tiny');
  });

  it('state isolation between two ctx instances', async () => {
    const registry = createRegistry();
    const ctxA = makeContext({ turnId: 'turn-a' });
    const ctxB = makeContext({ turnId: 'turn-b' });

    await registry.execute(
      makeCall('scratch_write', { path: 'shared-name.txt', content: 'only in A' }),
      ctxA,
    );

    const readA = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'shared-name.txt' }), ctxA),
    );
    const readB = parseOutput(
      await registry.execute(makeCall('scratch_read', { path: 'shared-name.txt' }), ctxB),
    );

    expect(readA).toEqual({
      ok: true,
      content: 'only in A',
    });
    expect(readB).toEqual({
      ok: false,
      error: 'Not found: shared-name.txt',
    });
  });
});
