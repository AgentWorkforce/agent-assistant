import { validateTurnContextInput } from './validation.js';
import { resolveIdentity } from './identity.js';
import { resolveExpression } from './expression.js';
import { projectToHarness } from './projection.js';
// ─── Instruction composition ──────────────────────────────────────────────────
/**
 * Composes the TurnInstructionBundle from identity base instructions,
 * shaping overlays, and guardrail overlays.
 *
 * Layer order (spec section 5.3):
 * 1. base system segments
 * 2. base developer segments
 * 3. product instruction overlays sorted by priority
 * 4. guardrail segments sorted by priority
 */
function composeInstructions(input) {
    const systemSegments = [];
    const developerSegments = [];
    const guardrailSegments = [];
    // Step 1: base system segment
    const systemPrompt = input.identity.baseInstructions?.systemPrompt;
    if (systemPrompt && systemPrompt.trim()) {
        systemSegments.push({
            id: 'base-system',
            source: 'identity',
            text: systemPrompt,
            priority: 'high',
        });
    }
    // Step 2: base developer segment
    const developerPrompt = input.identity.baseInstructions?.developerPrompt;
    if (developerPrompt && developerPrompt.trim()) {
        developerSegments.push({
            id: 'base-developer',
            source: 'identity',
            text: developerPrompt,
            priority: 'high',
        });
    }
    // Step 3: product instruction overlays
    const overlays = input.shaping?.instructionOverlays ?? [];
    for (const overlay of overlays) {
        const segment = {
            id: overlay.id,
            source: overlay.source,
            text: overlay.text,
            priority: overlay.priority ?? 'medium',
        };
        // Mode-related overlays go into developer segments; general overlays also go into developer
        developerSegments.push(segment);
    }
    // Append mode as a developer segment when present and no overlay already covers it
    const mode = input.shaping?.mode;
    if (mode) {
        developerSegments.push({
            id: 'shaping-mode',
            source: 'shaping',
            text: `Current mode: ${mode}`,
            priority: 'medium',
        });
    }
    // Step 4: guardrail segments
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
// ─── Memory projection ────────────────────────────────────────────────────────
/** Max memory blocks included in a single turn. Simple cap per spec section 5.5. */
const MAX_MEMORY_BLOCKS = 10;
function projectMemoryCandidates(candidates) {
    // Sort by relevance descending (higher relevance preferred), then cap
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
// ─── Enrichment projection ────────────────────────────────────────────────────
/** Max enrichment blocks included in a single turn. */
const MAX_ENRICHMENT_BLOCKS = 8;
function projectEnrichmentCandidates(candidates) {
    const importanceOrder = { high: 2, medium: 1, low: 0 };
    // Exclude product-only candidates (not intended for assistant)
    const assistantFacing = candidates.filter((c) => c.audience !== 'product');
    const productOnly = candidates.filter((c) => c.audience === 'product');
    // Sort by importance descending, then cap
    const sorted = [...assistantFacing].sort((a, b) => (importanceOrder[b.importance ?? 'medium'] ?? 1) - (importanceOrder[a.importance ?? 'medium'] ?? 1));
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
// ─── Session projection ───────────────────────────────────────────────────────
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
// ─── Default assembler ────────────────────────────────────────────────────────
class DefaultTurnContextAssembler {
    async assemble(input) {
        // Step 1: validate
        validateTurnContextInput(input);
        // Step 2: resolve identity
        const identity = resolveIdentity(input.identity);
        // Step 3: resolve expression
        const expression = resolveExpression(input.identity.traits, input.shaping, input.session, input.guardrails);
        // Step 4: compose instruction bundle
        const instructions = composeInstructions(input);
        // Step 5: project memory candidates
        const memoryCandidates = input.memory?.candidates ?? [];
        const { blocks: memoryBlocks, usedIds: usedMemoryIds } = projectMemoryCandidates(memoryCandidates);
        // Step 6: project enrichment candidates
        const enrichmentCandidates = input.enrichment?.candidates ?? [];
        const { blocks: enrichmentBlocks, usedIds: usedEnrichmentIds, droppedIds: droppedEnrichmentIds, } = projectEnrichmentCandidates(enrichmentCandidates);
        // Step 7: project session input
        const sessionBlock = projectSessionInput(input);
        const sessionBlocks = sessionBlock ? [sessionBlock] : [];
        // Step 8: build provenance
        const usedGuardrailIds = (input.guardrails?.overlays ?? []).map((g) => g.id);
        const context = {
            blocks: [...sessionBlocks, ...memoryBlocks, ...enrichmentBlocks],
        };
        // Step 9: project to harness format
        const harnessProjection = projectToHarness(instructions, context, input.shaping?.responseStyle);
        // Step 10: return assembly
        const assembly = {
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
        return assembly;
    }
}
export function createTurnContextAssembler(_options) {
    return new DefaultTurnContextAssembler();
}
