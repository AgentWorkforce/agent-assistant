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
    await this.storage.put(recordKey(record.id), record);

    if (record.sessionId) {
      await this.storage.put(sessionKey(record.sessionId, record.id), record.id);
    }

    const triggerKey = continuationTriggerIndexKey(record);
    if (triggerKey) {
      await this.triggerIndex?.put(triggerKey, record.id);
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

    const continuationId = await this.triggerIndex.get(resumeTriggerIndexKey(trigger));
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
      return `trigger:scheduled_wake:${record.waitFor.wakeUpId ?? record.id}`;
    case 'user_reply':
      return record.waitFor.correlationKey
        ? `trigger:user_reply:${record.waitFor.correlationKey}`
        : undefined;
  }
}

export function resumeTriggerIndexKey(trigger: ContinuationResumeTrigger): string {
  switch (trigger.type) {
    case 'approval_resolution':
      return `trigger:approval_resolution:${trigger.approvalId}`;
    case 'external_result':
      return `trigger:external_result:${trigger.operationId}`;
    case 'scheduled_wake':
      return `trigger:scheduled_wake:${trigger.wakeUpId ?? ''}`;
    case 'user_reply':
      return `trigger:user_reply:${trigger.message.id}`;
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
