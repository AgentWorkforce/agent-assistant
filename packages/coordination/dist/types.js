export class CoordinationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CoordinationError';
    }
}
export class SpecialistConflictError extends CoordinationError {
    constructor(name) {
        super(`Specialist already registered: ${name}`);
        this.name = 'SpecialistConflictError';
    }
}
export class SpecialistNotFoundError extends CoordinationError {
    constructor(name) {
        super(`Specialist not found: ${name}`);
        this.name = 'SpecialistNotFoundError';
    }
}
export class DelegationPlanError extends CoordinationError {
    constructor(message) {
        super(message);
        this.name = 'DelegationPlanError';
    }
}
export class SynthesisError extends CoordinationError {
    constructor(message) {
        super(message);
        this.name = 'SynthesisError';
    }
}
export class CoordinationBlockedError extends CoordinationError {
    constructor(message) {
        super(message);
        this.name = 'CoordinationBlockedError';
    }
}
//# sourceMappingURL=types.js.map