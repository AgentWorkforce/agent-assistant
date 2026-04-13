/**
 * Resolves TurnIdentityInput into a TurnIdentityProjection.
 *
 * Rules:
 * - traitsApplied is true when traits contributed identity defaults
 * - identitySummary contains short structural strings, not rendered prompt text
 * - runtime enrichment never overwrites the identity floor
 */
export function resolveIdentity(input) {
    const summary = [];
    if (input.assistantName) {
        summary.push(`name:${input.assistantName}`);
    }
    const traitsApplied = input.traits !== undefined;
    if (traitsApplied && input.traits) {
        const t = input.traits.traits;
        if (t.voice)
            summary.push(`voice:${t.voice}`);
        if (t.formality)
            summary.push(`formality:${t.formality}`);
        if (t.proactivity)
            summary.push(`proactivity:${t.proactivity}`);
        if (t.riskPosture)
            summary.push(`risk-posture:${t.riskPosture}`);
        if (t.domain)
            summary.push(`domain:${t.domain}`);
    }
    if (input.baseInstructions?.systemPrompt) {
        summary.push('base:system-prompt-present');
    }
    if (input.baseInstructions?.developerPrompt) {
        summary.push('base:developer-prompt-present');
    }
    return {
        assistantName: input.assistantName,
        traitsApplied,
        identitySummary: summary,
    };
}
