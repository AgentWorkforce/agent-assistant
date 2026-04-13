/**
 * Priority order for expression field values.
 * Lower index = lower value.
 */
const DIRECTNESS_ORDER = ['low', 'medium', 'high'];
const WARMTH_ORDER = ['low', 'medium', 'high'];
const HUMOR_ORDER = ['off', 'light', 'normal'];
const INITIATIVE_ORDER = ['low', 'medium', 'high'];
const EXPLANATION_ORDER = ['low', 'medium', 'high'];
function capValue(current, cap, order) {
    if (current === undefined)
        return cap;
    if (cap === undefined)
        return current;
    const currentIdx = order.indexOf(current);
    const capIdx = order.indexOf(cap);
    if (currentIdx === -1 || capIdx === -1)
        return current;
    return currentIdx <= capIdx ? current : cap;
}
/**
 * Derive a base expression profile from traits.
 * This is a simple lookup table, not a heuristic engine.
 */
function expressionFromTraits(traits) {
    const profile = {};
    const t = traits.traits;
    // voice -> directness
    if (t.voice === 'concise')
        profile.directness = 'high';
    else if (t.voice === 'verbose')
        profile.directness = 'low';
    else if (t.voice === 'balanced')
        profile.directness = 'medium';
    // formality -> warmth, humor
    if (t.formality === 'formal' || t.formality === 'professional') {
        profile.warmth = 'medium';
        profile.humor = 'light';
    }
    else if (t.formality === 'casual') {
        profile.warmth = 'high';
        profile.humor = 'normal';
    }
    else if (t.formality === 'friendly') {
        profile.warmth = 'high';
        profile.humor = 'light';
    }
    // proactivity -> initiative
    if (t.proactivity === 'high')
        profile.initiative = 'high';
    else if (t.proactivity === 'medium')
        profile.initiative = 'medium';
    else if (t.proactivity === 'low')
        profile.initiative = 'low';
    // voice again -> explanationDensity
    if (t.voice === 'concise')
        profile.explanationDensity = 'low';
    else if (t.voice === 'verbose')
        profile.explanationDensity = 'high';
    else
        profile.explanationDensity = 'medium';
    return profile;
}
/**
 * Apply session-derived soft nudges.
 * Only lightweight, obvious adjustments — no recap or continuity intelligence.
 */
function applySessionNudges(profile, session) {
    const out = { ...profile };
    // A cold-open turn may default to slightly higher explanation density
    if (session.state === 'cold' && out.explanationDensity === undefined) {
        out.explanationDensity = 'medium';
    }
    // Low conversational momentum nudges explanation density up
    if (session.conversationalMomentum === 'low' && out.explanationDensity === 'low') {
        out.explanationDensity = 'medium';
    }
    return out;
}
/**
 * Apply guardrail-constrained downgrades.
 * Supported downgrades in v1:
 * - tone_constraint or sensitivity_constraint -> cap humor, reduce warmth
 */
function applyGuardrailDowngrades(profile, overlays) {
    let out = { ...profile };
    for (const overlay of overlays) {
        if (overlay.kind === 'tone_constraint' || overlay.kind === 'sensitivity_constraint') {
            // Cap humor to 'light' for tone/sensitivity constraints; 'off' for high priority
            const humorCap = overlay.priority === 'high' ? 'off' : 'light';
            out.humor = capValue(out.humor, humorCap, HUMOR_ORDER);
        }
    }
    return out;
}
/**
 * Resolves the effective TurnExpressionProfile for a turn.
 *
 * Resolution order (spec section 5.4):
 * 1. Traits-derived defaults
 * 2. shaping.expressionOverrides (wins over trait defaults)
 * 3. Session-derived soft adjustments
 * 4. Guardrail-constrained downgrades
 */
export function resolveExpression(traits, shaping, session, guardrails) {
    // Step 1: start from traits-derived defaults
    let profile = traits ? expressionFromTraits(traits) : {};
    // Step 2: apply shaping expressionOverrides
    if (shaping?.expressionOverrides) {
        profile = { ...profile, ...shaping.expressionOverrides };
    }
    // Step 3: session-derived soft adjustments
    if (session) {
        profile = applySessionNudges(profile, session);
    }
    // Step 4: guardrail downgrades
    const overlays = guardrails?.overlays ?? [];
    if (overlays.length > 0) {
        profile = applyGuardrailDowngrades(profile, overlays);
    }
    // Clamp undefined fields to sensible defaults so expression is always fully populated
    return {
        tone: profile.tone,
        directness: profile.directness ?? 'medium',
        warmth: profile.warmth ?? 'medium',
        humor: profile.humor ?? 'light',
        initiative: profile.initiative ?? 'medium',
        explanationDensity: profile.explanationDensity ?? 'medium',
    };
}
// Re-export order arrays for tests
export { DIRECTNESS_ORDER, HUMOR_ORDER, INITIATIVE_ORDER, WARMTH_ORDER, EXPLANATION_ORDER };
