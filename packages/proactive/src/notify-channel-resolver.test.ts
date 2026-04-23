import type { BotChannel } from '@agent-assistant/surfaces';
import { describe, expect, it, vi } from 'vitest';

import type { ChatFn, ProactivePayload } from './channel-picker.js';
import {
  getNotifyChannelPref,
  setNotifyChannelPref,
  type PrefStore,
} from './notify-channel-prefs.js';
import {
  AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS,
  resolveNotifyChannel,
} from './notify-channel-resolver.js';

function createInMemoryStore(): PrefStore {
  const data = new Map<string, string>();
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

const payload: ProactivePayload = { kind: 'follow-up', topic: 't', preview: 'p' };

const channels: BotChannel[] = [
  { id: 'C1', name: 'general' },
  { id: 'C2', name: 'incidents' },
];

const deterministicChat: ChatFn = async () => ({
  content: JSON.stringify({ channelId: 'C2', confidence: 0.9, reason: 'topic match' }),
});

describe('resolveNotifyChannel', () => {
  it('bodyOverride wins over everything', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C-pref', true);
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => channels,
      workspaceId: 'W1',
      payload,
      bodyOverride: 'C-override',
    });
    expect(result).toEqual({
      channel: 'C-override',
      shouldAppendConfirmPrompt: false,
      source: 'body',
    });
  });

  it('confirmed pref returns pref-confirmed with no prompt', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C-pref', true);
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => channels,
      workspaceId: 'W1',
      payload,
    });
    expect(result).toEqual({
      channel: 'C-pref',
      shouldAppendConfirmPrompt: false,
      source: 'pref-confirmed',
    });
  });

  it('unconfirmed pref returns pref-unconfirmed with prompt and increments counter', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C-pref', false);
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => channels,
      workspaceId: 'W1',
      payload,
    });
    expect(result).toEqual({
      channel: 'C-pref',
      shouldAppendConfirmPrompt: true,
      source: 'pref-unconfirmed',
    });
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref?.unconfirmedPosts).toBe(1);
    expect(pref?.confirmed).toBe(false);
  });

  it('flips to confirmed on the post that hits the threshold', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C-pref', false);
    // Prime unconfirmedPosts so the next resolve call is the one that hits the threshold
    for (let i = 0; i < AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS - 1; i += 1) {
      await resolveNotifyChannel({
        store,
        chat: deterministicChat,
        listChannels: async () => channels,
        workspaceId: 'W1',
        payload,
      });
    }
    // This call should increment to threshold and flip confirmed=true
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => channels,
      workspaceId: 'W1',
      payload,
    });
    expect(result?.source).toBe('pref-unconfirmed');
    expect(result?.shouldAppendConfirmPrompt).toBe(true);
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref?.confirmed).toBe(true);
    // setNotifyChannelPref resets unconfirmedPosts to 0
    expect(pref?.unconfirmedPosts).toBe(0);
  });

  it('discovery path writes pref + increments + returns discovery', async () => {
    const store = createInMemoryStore();
    const listChannels = vi.fn(async () => channels);
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels,
      workspaceId: 'W1',
      payload,
    });
    expect(result).toEqual({
      channel: 'C2',
      shouldAppendConfirmPrompt: true,
      source: 'discovery',
    });
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref).toMatchObject({ channel: 'C2', confirmed: false, unconfirmedPosts: 1 });
    expect(listChannels).toHaveBeenCalledOnce();
  });

  it('returns null when no pref and discovery returns no channels', async () => {
    const store = createInMemoryStore();
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => [],
      workspaceId: 'W1',
      payload,
    });
    expect(result).toBeNull();
  });

  it('returns null when listChannels throws', async () => {
    const store = createInMemoryStore();
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => {
        throw new Error('invalid_auth');
      },
      workspaceId: 'W1',
      payload,
    });
    expect(result).toBeNull();
  });

  it('returns null when workspaceId is empty', async () => {
    const store = createInMemoryStore();
    const result = await resolveNotifyChannel({
      store,
      chat: deterministicChat,
      listChannels: async () => channels,
      workspaceId: '   ',
      payload,
    });
    expect(result).toBeNull();
  });
});
