// ─── Error classes ────────────────────────────────────────────────────────────
export class ContinuationError extends Error {
    continuationId;
    constructor(message, continuationId) {
        super(message);
        this.continuationId = continuationId;
        this.name = 'ContinuationError';
    }
}
export class ContinuationNotFoundError extends ContinuationError {
    constructor(continuationId) {
        super(`Continuation not found: ${continuationId}`, continuationId);
        this.name = 'ContinuationNotFoundError';
    }
}
export class ContinuationExpiredError extends ContinuationError {
    constructor(continuationId, expiresAt) {
        super(`Continuation ${continuationId} expired at ${expiresAt}`, continuationId);
        this.name = 'ContinuationExpiredError';
    }
}
export class ContinuationAlreadyTerminalError extends ContinuationError {
    constructor(continuationId, status) {
        super(`Continuation ${continuationId} is already in terminal status: ${status}`, continuationId);
        this.name = 'ContinuationAlreadyTerminalError';
    }
}
export class ContinuationTriggerMismatchError extends ContinuationError {
    constructor(continuationId, expected, received) {
        super(`Continuation ${continuationId} expects trigger type '${expected}' but received '${received}'`, continuationId);
        this.name = 'ContinuationTriggerMismatchError';
    }
}
export class ContinuationInvalidInputError extends ContinuationError {
    constructor(message, continuationId) {
        super(message, continuationId);
        this.name = 'ContinuationInvalidInputError';
    }
}
