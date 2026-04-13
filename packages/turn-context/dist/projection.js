const PRIORITY_ORDER = { low: 0, medium: 1, high: 2 };
function priorityOf(seg) {
    return PRIORITY_ORDER[seg.priority ?? 'medium'];
}
function sortByPriority(segments) {
    return [...segments].sort((a, b) => priorityOf(b) - priorityOf(a));
}
function joinSegments(segments) {
    return sortByPriority(segments)
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join('\n\n');
}
/**
 * Projects the internal turn assembly into HarnessInstructions + HarnessPreparedContext.
 *
 * Projection rules:
 * - systemSegments concatenated (sorted high->low priority) -> HarnessInstructions.systemPrompt
 * - developerSegments + guardrailSegments concatenated -> HarnessInstructions.developerPrompt
 * - TurnPreparedContextBlock[] maps 1:1 to HarnessContextBlock[] (shape-compatible)
 * - responseStyle passed through when present
 */
export function projectToHarness(instructions, context, responseStyle) {
    const systemPrompt = joinSegments(instructions.systemSegments);
    const developerParts = [
        ...sortByPriority(instructions.developerSegments),
        ...sortByPriority(instructions.guardrailSegments),
    ];
    const developerPrompt = developerParts.length > 0
        ? developerParts
            .map((s) => s.text.trim())
            .filter(Boolean)
            .join('\n\n')
        : undefined;
    const harnessInstructions = {
        systemPrompt,
        ...(developerPrompt !== undefined ? { developerPrompt } : {}),
        ...(responseStyle !== undefined ? { responseStyle } : {}),
    };
    const harnessContext = {
        blocks: context.blocks.map((block) => ({
            id: block.id,
            label: block.label,
            content: block.content,
            ...(block.importance !== undefined ? { importance: block.importance } : {}),
            ...(block.source !== undefined ? { source: block.source } : {}),
        })),
        ...(context.structured !== undefined ? { structured: context.structured } : {}),
    };
    return {
        instructions: harnessInstructions,
        context: harnessContext,
    };
}
