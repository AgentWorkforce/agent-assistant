import type { TurnIdentityInput, TurnIdentityProjection } from './types.js';
/**
 * Resolves TurnIdentityInput into a TurnIdentityProjection.
 *
 * Rules:
 * - traitsApplied is true when traits contributed identity defaults
 * - identitySummary contains short structural strings, not rendered prompt text
 * - runtime enrichment never overwrites the identity floor
 */
export declare function resolveIdentity(input: TurnIdentityInput): TurnIdentityProjection;
