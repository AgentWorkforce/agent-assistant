import type {
  ContinuationRecord,
  ContinuationResumeTrigger,
  ContinuationStore,
} from '@agent-assistant/continuation';

import type { FirestoreCollectionLike, FirestoreQuery } from './gcp-firestore-session-store-adapter.js';

export interface GcpFirestoreContinuationStoreOptions {
  collection: FirestoreCollectionLike<ContinuationRecord>;
}

export class GcpFirestoreContinuationStore implements ContinuationStore {
  private readonly col: FirestoreCollectionLike<ContinuationRecord>;

  constructor(options: GcpFirestoreContinuationStoreOptions) {
    this.col = options.collection;
  }

  async put(record: ContinuationRecord): Promise<void> {
    await this.col.doc(record.id).set(record);
  }

  async get(continuationId: string): Promise<ContinuationRecord | null> {
    const snap = await this.col.doc(continuationId).get();
    return snap.exists ? (snap.data() as ContinuationRecord) : null;
  }

  async delete(continuationId: string): Promise<void> {
    await this.col.doc(continuationId).delete();
  }

  async listBySession(sessionId: string): Promise<ContinuationRecord[]> {
    const snap = await (this.col as FirestoreQuery<ContinuationRecord>)
      .where('sessionId', '==', sessionId)
      .get();
    return snap.docs.map((d) => d.data() as ContinuationRecord);
  }

  /**
   * Find a pending continuation by its resume trigger.
   * Firestore queries by the trigger-specific correlation field.
   * Returns null for user_reply triggers without a correlationKey (no symmetric field to query).
   */
  async findByTrigger(trigger: ContinuationResumeTrigger): Promise<ContinuationRecord | null> {
    const constraint = triggerConstraint(trigger);
    if (!constraint) return null;

    const snap = await (this.col as FirestoreQuery<ContinuationRecord>)
      .where(constraint.field, '==', constraint.value)
      .limit(1)
      .get();

    return snap.docs[0] ? (snap.docs[0].data() as ContinuationRecord) : null;
  }
}

interface TriggerConstraint {
  field: string;
  value: string;
}

function triggerConstraint(trigger: ContinuationResumeTrigger): TriggerConstraint | null {
  switch (trigger.type) {
    case 'approval_resolution':
      return { field: 'waitFor.approvalId', value: trigger.approvalId };
    case 'external_result':
      return { field: 'waitFor.operationId', value: trigger.operationId };
    case 'scheduled_wake':
      return trigger.wakeUpId ? { field: 'waitFor.wakeUpId', value: trigger.wakeUpId } : null;
    case 'user_reply':
      return null;
  }
}
