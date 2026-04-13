import type { TraitsProvider } from '@agent-assistant/traits';
import type { TurnExpressionProfile, TurnGuardrailInput, TurnSessionInput, TurnShapingInput } from './types.js';
/**
 * Priority order for expression field values.
 * Lower index = lower value.
 */
declare const DIRECTNESS_ORDER: Array<TurnExpressionProfile['directness']>;
declare const WARMTH_ORDER: Array<TurnExpressionProfile['warmth']>;
declare const HUMOR_ORDER: Array<TurnExpressionProfile['humor']>;
declare const INITIATIVE_ORDER: Array<TurnExpressionProfile['initiative']>;
declare const EXPLANATION_ORDER: Array<TurnExpressionProfile['explanationDensity']>;
/**
 * Resolves the effective TurnExpressionProfile for a turn.
 *
 * Resolution order (spec section 5.4):
 * 1. Traits-derived defaults
 * 2. shaping.expressionOverrides (wins over trait defaults)
 * 3. Session-derived soft adjustments
 * 4. Guardrail-constrained downgrades
 */
export declare function resolveExpression(traits: TraitsProvider | undefined, shaping: TurnShapingInput | undefined, session: TurnSessionInput | undefined, guardrails: TurnGuardrailInput | undefined): TurnExpressionProfile;
export { DIRECTNESS_ORDER, HUMOR_ORDER, INITIATIVE_ORDER, WARMTH_ORDER, EXPLANATION_ORDER };
