import type { ContinuationRecord, ContinuationStore } from './types.js';
/**
 * In-memory ContinuationStore for testing and development.
 *
 * Uses structuredClone to prevent stored records from being mutated externally.
 * Not suitable for production use — does not survive process restarts.
 */
export declare class InMemoryContinuationStore implements ContinuationStore {
    private readonly records;
    put(record: ContinuationRecord): Promise<void>;
    get(continuationId: string): Promise<ContinuationRecord | null>;
    delete(continuationId: string): Promise<void>;
    listBySession(sessionId: string): Promise<ContinuationRecord[]>;
    /** Convenience for tests — number of stored records. */
    size(): number;
    /** Convenience for tests — clear all records. */
    clear(): void;
}
