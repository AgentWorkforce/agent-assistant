export class SessionNotFoundError extends Error {
    sessionId;
    constructor(sessionId) {
        super(`Session not found: ${sessionId}`);
        this.sessionId = sessionId;
        this.name = 'SessionNotFoundError';
    }
}
export class SessionConflictError extends Error {
    sessionId;
    constructor(sessionId) {
        super(`Session already exists: ${sessionId}`);
        this.sessionId = sessionId;
        this.name = 'SessionConflictError';
    }
}
export class SessionStateError extends Error {
    sessionId;
    currentState;
    attemptedTransition;
    constructor(sessionId, currentState, attemptedTransition) {
        super(`Invalid transition '${attemptedTransition}' from state '${currentState}' for session ${sessionId}`);
        this.sessionId = sessionId;
        this.currentState = currentState;
        this.attemptedTransition = attemptedTransition;
        this.name = 'SessionStateError';
    }
}
