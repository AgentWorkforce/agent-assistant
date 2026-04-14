import type { TraitsProvider } from '@agent-assistant/traits';
import type { HarnessContinuation, HarnessInstructions, HarnessPreparedContext } from '@agent-assistant/harness';
export interface TurnContextAssembler {
    assemble(input: TurnContextInput): Promise<TurnContextAssembly>;
}
export interface TurnContextInput {
    /** Stable assistant identifier. */
    assistantId: string;
    /** Product-generated unique turn id. */
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    /** Required: product-owned identity floor for this turn. */
    identity: TurnIdentityInput;
    /** Turn-scoped product behavioral shaping. */
    shaping?: TurnShapingInput;
    /** Optional session continuity inputs. */
    session?: TurnSessionInput;
    /** Optional pre-retrieved memory candidates. */
    memory?: TurnMemoryInput;
    /** Optional pre-packaged backstage enrichment candidates. */
    enrichment?: TurnEnrichmentInput;
    /** Optional expression guardrail overlays. */
    guardrails?: TurnGuardrailInput;
    /** Optional continuation from a prior turn. */
    continuation?: HarnessContinuation;
    metadata?: Record<string, unknown>;
}
export interface TurnIdentityInput {
    assistantName?: string;
    traits?: TraitsProvider;
    /**
     * Product-owned base guidance that expresses the assistant's stable identity.
     * At least one of systemPrompt or developerPrompt must be present.
     */
    baseInstructions?: {
        systemPrompt?: string;
        developerPrompt?: string;
    };
}
export interface TurnShapingInput {
    /** Product-owned turn mode, e.g. "review", "founder-advisory", "support" */
    mode?: string;
    /** Human-authored per-turn overlays. */
    instructionOverlays?: TurnInstructionOverlay[];
    /** Structured expression goals for this turn. */
    expressionOverrides?: Partial<TurnExpressionProfile>;
    /** Response-format hints for downstream harness/model use. */
    responseStyle?: {
        preferMarkdown?: boolean;
        maxAnswerChars?: number;
    };
}
export interface TurnInstructionOverlay {
    id: string;
    source: string;
    text: string;
    priority?: 'low' | 'medium' | 'high';
}
export interface TurnSessionInput {
    state?: 'cold' | 'active' | 'resumed';
    summary?: string;
    recentUnresolvedQuestions?: string[];
    conversationalMomentum?: 'low' | 'medium' | 'high';
    surfaceId?: string;
    surfaceType?: string;
}
export interface TurnMemoryInput {
    candidates?: TurnMemoryCandidate[];
}
export interface TurnMemoryRetrievalInput {
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    query?: string;
    limit?: number;
    metadata?: Record<string, unknown>;
}
export interface TurnMemoryCandidate {
    id: string;
    text: string;
    scope?: 'session' | 'user' | 'workspace' | 'org' | 'object';
    source?: string;
    relevance?: number;
    freshness?: 'stale' | 'recent' | 'current';
    metadata?: Record<string, unknown>;
}
export interface TurnEnrichmentInput {
    candidates?: TurnEnrichmentCandidate[];
}
export interface TurnEnrichmentCandidate {
    id: string;
    kind: 'specialist_memo' | 'handoff' | 'review' | 'workspace_state' | 'external_snapshot' | 'culture_context' | 'tool_observation' | 'other';
    source: string;
    title?: string;
    content: string;
    importance?: 'low' | 'medium' | 'high';
    confidence?: number;
    freshness?: 'stale' | 'recent' | 'current';
    /** Candidates with audience 'product' are excluded from assistant-facing context. */
    audience?: 'assistant' | 'product' | 'mixed';
    metadata?: Record<string, unknown>;
}
export interface TurnGuardrailInput {
    overlays?: TurnGuardrailOverlay[];
}
export interface TurnGuardrailOverlay {
    id: string;
    source: string;
    rule: string;
    priority?: 'low' | 'medium' | 'high';
    kind?: 'tone_constraint' | 'sensitivity_constraint' | 'truthfulness_constraint' | 'channel_constraint' | 'identity_preservation' | 'other';
}
export interface TurnExpressionProfile {
    tone?: string;
    directness?: 'low' | 'medium' | 'high';
    warmth?: 'low' | 'medium' | 'high';
    humor?: 'off' | 'light' | 'normal';
    initiative?: 'low' | 'medium' | 'high';
    explanationDensity?: 'low' | 'medium' | 'high';
}
export interface TurnContextAssembly {
    assistantId: string;
    turnId: string;
    sessionId?: string;
    userId?: string;
    threadId?: string;
    identity: TurnIdentityProjection;
    expression: TurnExpressionProfile;
    instructions: TurnInstructionBundle;
    context: TurnPreparedContext;
    provenance: TurnContextProvenance;
    harnessProjection: {
        instructions: HarnessInstructions;
        context: HarnessPreparedContext;
    };
    metadata?: Record<string, unknown>;
}
export interface TurnIdentityProjection {
    assistantName?: string;
    traitsApplied: boolean;
    /** Short structural summary of the identity floor. Not rendered prompt text. */
    identitySummary: string[];
}
export interface TurnInstructionBundle {
    systemSegments: TurnInstructionSegment[];
    developerSegments: TurnInstructionSegment[];
    guardrailSegments: TurnInstructionSegment[];
}
export interface TurnInstructionSegment {
    id: string;
    source: string;
    text: string;
    priority?: 'low' | 'medium' | 'high';
}
export interface TurnPreparedContext {
    blocks: TurnPreparedContextBlock[];
    structured?: Record<string, unknown>;
}
export interface TurnPreparedContextBlock {
    id: string;
    label: string;
    content: string;
    importance?: 'low' | 'medium' | 'high';
    source?: string;
    category?: 'memory' | 'session' | 'enrichment' | 'workspace' | 'guardrail' | 'other';
}
export interface TurnContextProvenance {
    usedMemoryIds: string[];
    usedEnrichmentIds: string[];
    usedGuardrailIds: string[];
    droppedEnrichmentIds?: string[];
}
export interface TurnMemoryProjector {
    project(input: TurnMemoryInput, context: TurnContextInput): Promise<TurnPreparedContextBlock[]>;
}
export interface TurnMemoryRetriever {
    retrieve(input: TurnMemoryRetrievalInput): Promise<TurnMemoryCandidate[]>;
}
export interface TurnEnrichmentProjector {
    project(input: TurnEnrichmentInput, context: TurnContextInput): Promise<{
        blocks: TurnPreparedContextBlock[];
        usedIds: string[];
        droppedIds: string[];
    }>;
}
export interface TurnInstructionComposer {
    compose(input: TurnContextInput): Promise<TurnInstructionBundle>;
}
