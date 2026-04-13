export class TurnContextValidationError extends Error {
    field;
    reason;
    constructor(field, reason) {
        super(`TurnContext validation failed: ${field} — ${reason}`);
        this.field = field;
        this.reason = reason;
        this.name = 'TurnContextValidationError';
    }
}
export function validateTurnContextInput(input) {
    if (!input.assistantId || typeof input.assistantId !== 'string' || input.assistantId.trim() === '') {
        throw new TurnContextValidationError('assistantId', 'must be a non-empty string');
    }
    if (!input.turnId || typeof input.turnId !== 'string' || input.turnId.trim() === '') {
        throw new TurnContextValidationError('turnId', 'must be a non-empty string');
    }
    if (!input.identity || typeof input.identity !== 'object') {
        throw new TurnContextValidationError('identity', 'must be present');
    }
    if (!input.identity.baseInstructions || typeof input.identity.baseInstructions !== 'object') {
        throw new TurnContextValidationError('identity.baseInstructions', 'must be present');
    }
    const { systemPrompt, developerPrompt } = input.identity.baseInstructions;
    const hasSystem = typeof systemPrompt === 'string' && systemPrompt.trim() !== '';
    const hasDeveloper = typeof developerPrompt === 'string' && developerPrompt.trim() !== '';
    if (!hasSystem && !hasDeveloper) {
        throw new TurnContextValidationError('identity.baseInstructions', 'at least one of systemPrompt or developerPrompt must be a non-empty string');
    }
}
