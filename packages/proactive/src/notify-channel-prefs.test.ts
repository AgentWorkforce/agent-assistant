import { describe, expect, it } from 'vitest';

import {
  getNotifyChannelPref,
  hasPrefStore,
  incrementUnconfirmedPosts,
  setNotifyChannelPref,
  type PrefStore,
} from './notify-channel-prefs.js';

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

describe('notify-channel-prefs', () => {
  it('returns null when unset', async () => {
    const store = createInMemoryStore();
    expect(await getNotifyChannelPref(store, 'W1')).toBeNull();
  });

  it('round-trips a pref via set + get', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C1', false);
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref).toMatchObject({
      channel: 'C1',
      confirmed: false,
      unconfirmedPosts: 0,
    });
    expect(typeof pref?.updatedAt).toBe('number');
  });

  it('incrementUnconfirmedPosts bumps count by 1', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C1', false);
    expect(await incrementUnconfirmedPosts(store, 'W1')).toBe(1);
    expect(await incrementUnconfirmedPosts(store, 'W1')).toBe(2);
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref?.unconfirmedPosts).toBe(2);
  });

  it('incrementUnconfirmedPosts preserves channel + confirmed on update', async () => {
    const store = createInMemoryStore();
    await setNotifyChannelPref(store, 'W1', 'C1', false);
    await incrementUnconfirmedPosts(store, 'W1');
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref).toMatchObject({ channel: 'C1', confirmed: false });
  });

  it('incrementUnconfirmedPosts starts from 0 when pref unset', async () => {
    const store = createInMemoryStore();
    expect(await incrementUnconfirmedPosts(store, 'W1')).toBe(1);
    const pref = await getNotifyChannelPref(store, 'W1');
    expect(pref?.unconfirmedPosts).toBe(1);
    expect(pref?.channel).toBe('');
  });

  it('returns null for malformed JSON', async () => {
    const store = createInMemoryStore();
    await store.put('notify-channel:W1', 'not json');
    expect(await getNotifyChannelPref(store, 'W1')).toBeNull();
  });

  it('returns null for valid JSON that fails schema validation', async () => {
    const store = createInMemoryStore();
    await store.put('notify-channel:W1', JSON.stringify({ channel: 'C1' }));
    expect(await getNotifyChannelPref(store, 'W1')).toBeNull();
  });

  describe('hasPrefStore', () => {
    it('recognises a store with get + put functions', () => {
      expect(hasPrefStore(createInMemoryStore())).toBe(true);
    });
    it('rejects undefined', () => {
      expect(hasPrefStore(undefined)).toBe(false);
    });
    it('rejects an object missing put', () => {
      expect(hasPrefStore({ get: async () => null })).toBe(false);
    });
  });
});
