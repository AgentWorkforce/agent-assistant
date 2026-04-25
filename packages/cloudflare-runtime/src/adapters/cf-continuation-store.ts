import type { KVNamespace } from '@cloudflare/workers-types';
import type {
  ContinuationRecord,
  ContinuationResumeTrigger,
  ContinuationStore,
} from '@agent-assistant/continuation';

export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

export interface CfContinuationStoreOptions {
  storage: DurableObjectStorageLike;
  triggerIndex?: KVNamespace;
}

export class CfContinuationStore implements ContinuationStore {
  private readonly storage: DurableObjectStorageLike;
  private readonly triggerIndex?: KVNamespace;

  constructor(options: CfContinuationStoreOptions) {
    this.storage = options.storage;
    this.triggerIndex = options.triggerIndex;
  }

  async put(record: ContinuationRecord): Promise<void> {
    // Read prior record so we can detect waitFor changes that invalidate the
    // existing trigger index entry. Without this, an update that changes the
    // trigger key would leave the old key still pointing at this record, and
    // findByTrigger could return a stale match for an unrelated trigger.
    const prior = await this.storage.get<ContinuationRecord>(recordKey(record.id));

    await this.storage.put(recordKey(record.id), record);

    if (record.sessionId) {
      await this.storage.put(sessionKey(record.sessionId, record.id), record.id);
    }

    const newTriggerKey = continuationTriggerIndexKey(record);
    const priorTriggerKey = prior ? continuationTriggerIndexKey(prior) : undefined;

    if (priorTriggerKey && priorTriggerKey !== newTriggerKey) {
      // Old trigger no longer matches the record — clear it so findByTrigger
      // can't resolve a now-incorrect continuation.
      await this.triggerIndex?.delete(priorTriggerKey);
    }

    if (newTriggerKey) {
      await this.triggerIndex?.put(newTriggerKey, record.id);
    }
  }

  async get(continuationId: string): Promise<ContinuationRecord | null> {
    return (await this.storage.get<ContinuationRecord>(recordKey(continuationId))) ?? null;
  }

  async delete(continuationId: string): Promise<void> {
    const existing = await this.get(continuationId);
    await this.storage.delete(recordKey(continuationId));

    if (existing?.sessionId) {
      await this.storage.delete(sessionKey(existing.sessionId, continuationId));
    }

    const triggerKey = existing ? continuationTriggerIndexKey(existing) : undefined;
    if (triggerKey) {
      await this.triggerIndex?.delete(triggerKey);
    }
  }

  async listBySession(sessionId: string): Promise<ContinuationRecord[]> {
    const sessionEntries = await this.storage.list<string>({ prefix: sessionPrefix(sessionId) });
    const records = await Promise.all(
      [...sessionEntries.values()].map((continuationId) => this.get(continuationId)),
    );
    return records.filter((record): record is ContinuationRecord => record !== null);
  }

  async findByTrigger(trigger: ContinuationResumeTrigger): Promise<ContinuationRecord | null> {
    if (!this.triggerIndex) {
      return null;
    }

    const key = resumeTriggerIndexKey(trigger);
    if (!key) {
      // user_reply triggers have no symmetric correlation field today; the
      // upstream ContinuationResumeTrigger user_reply variant carries
      // `message: HarnessUserMessage` while the waitFor side keys on
      // `correlationKey?: string`. Until the trigger shape carries a
      // correlationKey, findByTrigger can't resolve user_reply lookups via
      // the KV index — callers should use listBySession or extend the
      // trigger themselves. Return null explicitly rather than synthesize
      // a key that would never match.
      return null;
    }
    const continuationId = await this.triggerIndex.get(key);
    return continuationId ? this.get(continuationId) : null;
  }
}

export function continuationTriggerIndexKey(record: ContinuationRecord): string | undefined {
  switch (record.waitFor.type) {
    case 'approval_resolution':
      return `trigger:approval_resolution:${record.waitFor.approvalId}`;
    case 'external_result':
      return `trigger:external_result:${record.waitFor.operationId}`;
    case 'scheduled_wake':
      // Only emit a key when wakeUpId is present so create-side and resume-
      // side stay symmetric. If wakeUpId is absent, the trigger has nothing
      // to look up against — findByTrigger returns null rather than match a
      // wrong record.
      return record.waitFor.wakeUpId
        ? `trigger:scheduled_wake:${record.waitFor.wakeUpId}`
        : undefined;
    case 'user_reply':
      return record.waitFor.correlationKey
        ? `trigger:user_reply:${record.waitFor.correlationKey}`
        : undefined;
  }
}

// Returns the KV index key for a resume trigger, or `undefined` when the
// trigger type doesn't carry enough information to form a key that matches
// what `continuationTriggerIndexKey` produced at create time. The two
// functions are symmetric: a trigger that returns `undefined` here would
// have produced `undefined` from `continuationTriggerIndexKey` too, so
// findByTrigger correctly returns null instead of false-matching.
export function resumeTriggerIndexKey(
  trigger: ContinuationResumeTrigger,
): string | undefined {
  switch (trigger.type) {
    case 'approval_resolution':
      return `trigger:approval_resolution:${trigger.approvalId}`;
    case 'external_result':
      return `trigger:external_result:${trigger.operationId}`;
    case 'scheduled_wake':
      return trigger.wakeUpId
        ? `trigger:scheduled_wake:${trigger.wakeUpId}`
        : undefined;
    case 'user_reply':
      // Upstream ContinuationResumeTrigger user_reply variant has no
      // correlationKey. continuationTriggerIndexKey only emits a key when
      // record.waitFor.correlationKey is set, so the only safe behavior is
      // to refuse to synthesize a key from message.id (which would never
      // match the create-side key).
      return undefined;
  }
}

function recordKey(continuationId: string): string {
  return `continuation:${continuationId}`;
}

function sessionPrefix(sessionId: string): string {
  return `session:${sessionId}:`;
}

function sessionKey(sessionId: string, continuationId: string): string {
  return `${sessionPrefix(sessionId)}${continuationId}`;
}
