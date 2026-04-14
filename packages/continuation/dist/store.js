/**
 * In-memory ContinuationStore for testing and development.
 *
 * Uses structuredClone to prevent stored records from being mutated externally.
 * Not suitable for production use — does not survive process restarts.
 */
export class InMemoryContinuationStore {
    records = new Map();
    async put(record) {
        this.records.set(record.id, structuredClone(record));
    }
    async get(continuationId) {
        const record = this.records.get(continuationId);
        return record !== undefined ? structuredClone(record) : null;
    }
    async delete(continuationId) {
        this.records.delete(continuationId);
    }
    async listBySession(sessionId) {
        return [...this.records.values()]
            .filter((r) => r.sessionId === sessionId)
            .map((r) => structuredClone(r));
    }
    /** Convenience for tests — number of stored records. */
    size() {
        return this.records.size;
    }
    /** Convenience for tests — clear all records. */
    clear() {
        this.records.clear();
    }
}
