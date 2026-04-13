import type { TurnContextInput } from './types.js';
export declare class TurnContextValidationError extends Error {
    readonly field: string;
    readonly reason: string;
    constructor(field: string, reason: string);
}
export declare function validateTurnContextInput(input: TurnContextInput): void;
