import { validateTurnContextInput } from './validation.js';
import { resolveIdentity } from './identity.js';
import { resolveExpression } from './expression.js';
import { projectToHarness } from './projection.js';
// ─── Instruction composition ──────────────────────────────────────────────────
function composeInstructions(input) {
    const systemSegments = [];
    const developerSegments = [];
    const guardrailSegments = [];
    const systemPrompt = input.identity.baseInstructions?.systemPrompt;
    if (systemPrompt && systemPrompt.trim()) {
        systemSegments.push({
            id: 'base-system',
            source: 'identity',
            text: systemPrompt,
            priority: 'high',
        });
    }
    const developerPrompt = input.identity.baseInstructions?.developerPrompt;
    if (developerPrompt && developerPrompt.trim()) {
        developerSegments.push({
            id: 'base-developer',
            source: 'identity',
            text: developerPrompt,
            priority: 'high',
        });
    }
    const overlays = input.shaping?.instructionOverlays ?? [];
    for (const overlay of overlays) {
        developerSegments.push({
            id: overlay.id,
            source: overlay.source,
            text: overlay.text,
            priority: overlay.priority ?? 'medium',
        });
    }
    const mode = input.shaping?.mode;
    if (mode) {
        developerSegments.push({
            id: 'shaping-mode',
            source: 'shaping',
            text: `Current mode: ${mode}`,
            priority: 'medium',
        });
    }
    const guardrailOverlays = input.guardrails?.overlays ?? [];
    for (const guardrail of guardrailOverlays) {
        guardrailSegments.push({
            id: guardrail.id,
            source: guardrail.source,
            text: guardrail.rule,
            priority: guardrail.priority ?? 'medium',
        });
    }
    return { systemSegments, developerSegments, guardrailSegments };
}
const MAX_MEMORY_BLOCKS = 10;
function projectMemoryCandidates(candidates) {
    const sorted = [...candidates].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    const selected = sorted.slice(0, MAX_MEMORY_BLOCKS);
    const blocks = selected.map((c) => ({
        id: `memory-${c.id}`,
        label: c.scope ? `Memory [${c.scope}]` : 'Memory',
        content: c.text,
        importance: undefined,
        source: c.source ?? c.scope,
        category: 'memory',
    }));
    return {
        blocks,
        usedIds: selected.map((c) => c.id),
    };
}
const MAX_ENRICHMENT_BLOCKS = 8;
function projectEnrichmentCandidates(candidates) {
    const importanceOrder = { high: 2, medium: 1, low: 0 };
    const assistantFacing = candidates.filter((c) => c.audience !== 'product');
    const productOnly = candidates.filter((c) => c.audience === 'product');
    const sorted = [...assistantFacing].sort((a, b) => (importanceOrder[b.importance ?? 'medium'] ?? 1) -
        (importanceOrder[a.importance ?? 'medium'] ?? 1));
    const selected = sorted.slice(0, MAX_ENRICHMENT_BLOCKS);
    const dropped = sorted.slice(MAX_ENRICHMENT_BLOCKS);
    const blocks = selected.map((c) => ({
        id: `enrichment-${c.id}`,
        label: c.title ?? `${c.kind} from ${c.source}`,
        content: c.content,
        importance: c.importance,
        source: c.source,
        category: 'enrichment',
    }));
    return {
        blocks,
        usedIds: selected.map((c) => c.id),
        droppedIds: [...dropped, ...productOnly].map((c) => c.id),
    };
}
function projectSessionInput(input) {
    const session = input.session;
    if (!session)
        return null;
    const parts = [];
    if (session.state)
        parts.push(`State: ${session.state}`);
    if (session.summary)
        parts.push(`Summary: ${session.summary}`);
    if (session.recentUnresolvedQuestions && session.recentUnresolvedQuestions.length > 0) {
        parts.push(`Unresolved: ${session.recentUnresolvedQuestions.join('; ')}`);
    }
    if (session.conversationalMomentum)
        parts.push(`Momentum: ${session.conversationalMomentum}`);
    if (parts.length === 0)
        return null;
    return {
        id: `session-${input.sessionId ?? input.turnId}`,
        label: 'Session Context',
        content: parts.join('\n'),
        source: 'session',
        category: 'session',
    };
}
class DefaultTurnContextAssembler {
    memoryRetriever;
    constructor(memoryRetriever) {
        this.memoryRetriever = memoryRetriever;
    }
    async assemble(input) {
        validateTurnContextInput(input);
        const identity = resolveIdentity(input.identity);
        const expression = resolveExpression(input.identity.traits, input.shaping, input.session, input.guardrails);
        const instructions = composeInstructions(input);
        const providedMemoryCandidates = input.memory?.candidates;
        const retrievedMemoryCandidates = providedMemoryCandidates === undefined && this.memoryRetriever
            ? await this.memoryRetriever.retrieve({
                assistantId: input.assistantId,
                turnId: input.turnId,
                sessionId: input.sessionId,
                userId: input.userId,
                threadId: input.threadId,
                metadata: input.metadata,
            })
            : undefined;
        const memoryCandidates = providedMemoryCandidates ?? retrievedMemoryCandidates ?? [];
        const { blocks: memoryBlocks, usedIds: usedMemoryIds } = projectMemoryCandidates(memoryCandidates);
        const enrichmentCandidates = input.enrichment?.candidates ?? [];
        const { blocks: enrichmentBlocks, usedIds: usedEnrichmentIds, droppedIds: droppedEnrichmentIds, } = projectEnrichmentCandidates(enrichmentCandidates);
        const sessionBlock = projectSessionInput(input);
        const sessionBlocks = sessionBlock ? [sessionBlock] : [];
        const usedGuardrailIds = (input.guardrails?.overlays ?? []).map((g) => g.id);
        const context = {
            blocks: [...sessionBlocks, ...memoryBlocks, ...enrichmentBlocks],
        };
        const harnessProjection = projectToHarness(instructions, context, input.shaping?.responseStyle);
        return {
            assistantId: input.assistantId,
            turnId: input.turnId,
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            ...(input.userId !== undefined ? { userId: input.userId } : {}),
            ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
            identity,
            expression,
            instructions,
            context,
            provenance: {
                usedMemoryIds,
                usedEnrichmentIds,
                usedGuardrailIds,
                droppedEnrichmentIds,
            },
            harnessProjection,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        };
    }
}
export function createTurnContextAssembler(options) {
    return new DefaultTurnContextAssembler(options?.memoryRetriever);
}
