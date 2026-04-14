import type { ContinuationRecord, ContinuationStore } from './types.js';

/**
 * In-memory ContinuationStore for testing and development.
 *
 * Uses structuredClone to prevent stored records from being mutated externally.
 * Not suitable for production use — does not survive process restarts.
 */
export class InMemoryContinuationStore implements ContinuationStore {
  private readonly records = new Map<string, ContinuationRecord>();

  async put(record: ContinuationRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(continuationId: string): Promise<ContinuationRecord | null> {
    const record = this.records.get(continuationId);
    return record !== undefined ? structuredClone(record) : null;
  }

  async delete(continuationId: string): Promise<void> {
    this.records.delete(continuationId);
  }

  async listBySession(sessionId: string): Promise<ContinuationRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.sessionId === sessionId)
      .map((r) => structuredClone(r));
  }

  /** Convenience for tests — number of stored records. */
  size(): number {
    return this.records.size;
  }

  /** Convenience for tests — clear all records. */
  clear(): void {
    this.records.clear();
  }
}
