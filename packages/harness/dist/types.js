export class HarnessConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HarnessConfigError';
    }
}
