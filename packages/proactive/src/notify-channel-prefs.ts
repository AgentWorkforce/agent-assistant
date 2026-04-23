/**
 * Per-workspace notify-channel preferences backed by a pluggable key-value store.
 *
 * Consumers supply a {@link PrefStore} (e.g. a Cloudflare KV adapter on the
 * edge, or an in-memory Map for tests) and this module handles schema
 * validation, serialization, and the unconfirmed-posts counter used for
 * silent-fallback auto-confirmation.
 */

export interface PrefStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface NotifyChannelPref {
  channel: string;
  confirmed: boolean;
  unconfirmedPosts: number;
  updatedAt: number;
}

const notifyChannelKey = (workspaceId: string): string => `notify-channel:${workspaceId}`;

export function hasPrefStore(value: unknown): value is PrefStore {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Partial<PrefStore>).get === 'function' &&
      typeof (value as Partial<PrefStore>).put === 'function',
  );
}

function isNotifyChannelPref(value: unknown): value is NotifyChannelPref {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NotifyChannelPref>;
  return (
    typeof candidate.channel === 'string' &&
    typeof candidate.confirmed === 'boolean' &&
    typeof candidate.unconfirmedPosts === 'number' &&
    Number.isFinite(candidate.unconfirmedPosts) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  );
}

export async function getNotifyChannelPref(
  store: PrefStore,
  workspaceId: string,
): Promise<NotifyChannelPref | null> {
  const raw = await store.get(notifyChannelKey(workspaceId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isNotifyChannelPref(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setNotifyChannelPref(
  store: PrefStore,
  workspaceId: string,
  channel: string,
  confirmed: boolean,
): Promise<void> {
  await store.put(
    notifyChannelKey(workspaceId),
    JSON.stringify({
      channel,
      confirmed,
      unconfirmedPosts: 0,
      updatedAt: Date.now(),
    } satisfies NotifyChannelPref),
  );
}

/**
 * Reads the current pref, increments `unconfirmedPosts`, writes back.
 *
 * NOTE: read-modify-write over the pref store is not atomic. Under
 * concurrent writers, increments can be lost. For the notify-channel
 * use case this at worst delays the silent-fallback auto-confirm by
 * one post, which is acceptable. If callers need stronger guarantees,
 * they should wrap this behind a serialization mechanism (e.g. a
 * Cloudflare Durable Object).
 */
export async function incrementUnconfirmedPosts(
  store: PrefStore,
  workspaceId: string,
): Promise<number> {
  const current = await getNotifyChannelPref(store, workspaceId);
  const unconfirmedPosts = (current?.unconfirmedPosts ?? 0) + 1;

  await store.put(
    notifyChannelKey(workspaceId),
    JSON.stringify({
      channel: current?.channel ?? '',
      confirmed: current?.confirmed ?? false,
      unconfirmedPosts,
      updatedAt: Date.now(),
    } satisfies NotifyChannelPref),
  );

  return unconfirmedPosts;
}
