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
function mapContextCategory(category) {
    if (category === 'session') {
        return 'other';
    }
    return category;
}
function mapContextBlock(block) {
    const mappedCategory = mapContextCategory(block.category);
    return {
        id: block.id,
        label: block.label,
        text: block.content,
        ...(mappedCategory !== undefined ? { category: mappedCategory } : {}),
        ...(block.source !== undefined || block.importance !== undefined || block.category === 'session'
            ? {
                metadata: {
                    ...(block.source !== undefined ? { source: block.source } : {}),
                    ...(block.importance !== undefined ? { importance: block.importance } : {}),
                    ...(block.category === 'session' ? { turnContextCategory: 'session' } : {}),
                },
            }
            : {}),
    };
}
function mergeMetadata(assemblyMetadata, overrideMetadata) {
    if (assemblyMetadata === undefined && overrideMetadata === undefined) {
        return undefined;
    }
    return {
        ...(assemblyMetadata ?? {}),
        ...(overrideMetadata ?? {}),
    };
}
export function toExecutionRequest(assembly, userMessage, overrides = {}) {
    const context = {
        blocks: assembly.context.blocks.map(mapContextBlock),
        ...(assembly.context.structured !== undefined ? { structured: assembly.context.structured } : {}),
    };
    const metadata = mergeMetadata(assembly.metadata, overrides.metadata);
    return {
        assistantId: assembly.assistantId,
        turnId: assembly.turnId,
        ...(assembly.sessionId !== undefined ? { sessionId: assembly.sessionId } : {}),
        ...(assembly.userId !== undefined ? { userId: assembly.userId } : {}),
        ...(assembly.threadId !== undefined ? { threadId: assembly.threadId } : {}),
        message: userMessage,
        instructions: assembly.harnessProjection.instructions,
        context,
        ...(overrides.continuation !== undefined ? { continuation: overrides.continuation } : {}),
        ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
        ...(overrides.requirements !== undefined ? { requirements: overrides.requirements } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
    };
}
