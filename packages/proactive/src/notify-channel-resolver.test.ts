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

  // When the LLM declines / errors, pickChannel's internal fallback
  // selects a channel deterministically. Before this PR that fallback
  // always picked the first joined channel — usually random. Now it
  // prefers `#general` (case-insensitive), then first joined.
  describe('pickChannel fallback prefers #general', () => {
    const llmDeclines: ChatFn = async () => ({ content: 'I have no idea' });

    it('lands on #general when the bot is a member', async () => {
      const store = createInMemoryStore();
      const list: BotChannel[] = [
        { id: 'C_random', name: 'random' },
        { id: 'C_general', name: 'general' },
        { id: 'C_eng', name: 'engineering' },
      ];
      const result = await resolveNotifyChannel({
        store,
        chat: llmDeclines,
        listChannels: async () => list,
        workspaceId: 'W1',
        payload,
      });
      expect(result?.channel).toBe('C_general');
      expect(result?.source).toBe('discovery');
      const pref = await getNotifyChannelPref(store, 'W1');
      expect(pref).toMatchObject({ channel: 'C_general', confirmed: false, unconfirmedPosts: 1 });
    });

    it('matches #general case-insensitively', async () => {
      const store = createInMemoryStore();
      const list: BotChannel[] = [
        { id: 'C_eng', name: 'engineering' },
        { id: 'C_general', name: 'General' },
      ];
      const result = await resolveNotifyChannel({
        store,
        chat: llmDeclines,
        listChannels: async () => list,
        workspaceId: 'W1',
        payload,
      });
      expect(result?.channel).toBe('C_general');
    });

    it('picks the first joined channel when #general is not present', async () => {
      const store = createInMemoryStore();
      const list: BotChannel[] = [
        { id: 'C_eng', name: 'engineering' },
        { id: 'C_design', name: 'design' },
      ];
      const result = await resolveNotifyChannel({
        store,
        chat: llmDeclines,
        listChannels: async () => list,
        workspaceId: 'W1',
        payload,
      });
      expect(result?.channel).toBe('C_eng');
    });

    it('persists the fallback choice so the next run uses the stored pref-unconfirmed path', async () => {
      const store = createInMemoryStore();
      const list: BotChannel[] = [{ id: 'C_general', name: 'general' }, { id: 'C_eng', name: 'engineering' }];

      const first = await resolveNotifyChannel({
        store,
        chat: llmDeclines,
        listChannels: async () => list,
        workspaceId: 'W1',
        payload,
      });
      expect(first?.channel).toBe('C_general');

      // Second call: the stored unconfirmed pref short-circuits the
      // discovery + fallback paths entirely.
      const listChannels = vi.fn(async () => list);
      const second = await resolveNotifyChannel({
        store,
        chat: llmDeclines,
        listChannels,
        workspaceId: 'W1',
        payload,
      });
      expect(second?.channel).toBe('C_general');
      expect(second?.source).toBe('pref-unconfirmed');
      expect(listChannels).not.toHaveBeenCalled();
    });

    it('uses the LLM pick when the chat returns a valid choice (fallback is the safety net, not a default override)', async () => {
      const store = createInMemoryStore();
      const result = await resolveNotifyChannel({
        store,
        chat: deterministicChat,
        listChannels: async () => channels,
        workspaceId: 'W1',
        payload,
      });
      expect(result?.channel).toBe('C2');
      expect(result?.source).toBe('discovery');
    });
  });

  // Reference the constant so it's used in the test file (existing import
  // is preserved).
  it('AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS constant is exported', () => {
    expect(typeof AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS).toBe('number');
    expect(AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS).toBeGreaterThan(0);
  });
});
