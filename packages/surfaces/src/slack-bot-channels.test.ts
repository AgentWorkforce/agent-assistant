import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listBotChannels } from './slack-bot-channels.js';

const originalFetch = globalThis.fetch;

function mockFetchSequence(responses: Array<Record<string, unknown>>): void {
  let call = 0;
  globalThis.fetch = vi.fn(async () => {
    const payload = responses[call] ?? responses[responses.length - 1];
    call += 1;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

describe('listBotChannels', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps a single page of channels', async () => {
    mockFetchSequence([
      {
        ok: true,
        channels: [
          {
            id: 'C1',
            name: 'general',
            topic: { value: 'chatter' },
            purpose: { value: 'everyone' },
            num_members: 42,
          },
          { id: 'C2', name: 'random' },
        ],
      },
    ]);

    const channels = await listBotChannels('xoxb-token', 'U_BOT');
    expect(channels).toEqual([
      { id: 'C1', name: 'general', topic: 'chatter', purpose: 'everyone', numMembers: 42 },
      { id: 'C2', name: 'random' },
    ]);
  });

  it('follows next_cursor up to 3 pages then stops', async () => {
    mockFetchSequence([
      { ok: true, channels: [{ id: 'C1', name: 'a' }], response_metadata: { next_cursor: 'p2' } },
      { ok: true, channels: [{ id: 'C2', name: 'b' }], response_metadata: { next_cursor: 'p3' } },
      { ok: true, channels: [{ id: 'C3', name: 'c' }], response_metadata: { next_cursor: 'p4' } },
      { ok: true, channels: [{ id: 'C4', name: 'd' }] },
    ]);

    const channels = await listBotChannels('xoxb-token', 'U_BOT');
    expect(channels.map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
  });

  it('throws when Slack returns ok:false', async () => {
    mockFetchSequence([{ ok: false, error: 'invalid_auth' }]);

    await expect(listBotChannels('xoxb-token', 'U_BOT')).rejects.toThrow(/invalid_auth/);
  });

  it('drops malformed channel entries', async () => {
    mockFetchSequence([
      {
        ok: true,
        channels: [
          { id: 'C1', name: 'ok' },
          null,
          { id: 'C2' },
          { name: 'no-id' },
          'not-an-object',
        ],
      },
    ]);

    const channels = await listBotChannels('xoxb-token', 'U_BOT');
    expect(channels).toEqual([{ id: 'C1', name: 'ok' }]);
  });
});
