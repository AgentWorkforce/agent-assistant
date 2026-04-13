# v1 Turn-Context / Enrichment Spec — `@agent-assistant/turn-context`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-13
**Package:** `@agent-assistant/turn-context`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / wave-2 once implemented
**Boundary doc:** `docs/architecture/v1-turn-context-enrichment-boundary.md`

---

## 1. Responsibilities

`@agent-assistant/turn-context` owns the turn-scoped assembly contract that prepares the visible assistant's effective character + context for one turn.

It exists to solve the gap between:
- stable identity (`@agent-assistant/traits`)
- reusable enrichment sources (memory / coordination / connectivity)
- product-owned prompt and domain strategy
- harness turn execution (`@agent-assistant/harness`)

### Owns

- typed turn-context assembly inputs
- typed turn-context assembly outputs
- identity-preserving composition rules
- provenance-carrying enrichment packaging
- harness-projection compatibility (`HarnessInstructions` + `HarnessPreparedContext`)
- a small set of assembly interfaces for products or reusable adapters to implement

### Does NOT own

- model execution
- tool execution
- turn stop semantics
- session persistence
- memory persistence or retrieval
- policy evaluation
- specialist orchestration
- product business rules
- workforce persona definitions

---

## 2. Core design rule

Runtime enrichment must **inform** the assistant's expression for the turn, not replace its identity.

This package must preserve distinct sources in its contract:
- stable identity inputs
- product-authored overlays
- runtime enrichment inputs
- guardrail overlays

The package must not collapse these into one undifferentiated prompt string.

---

## 3. Canonical execution model

One assembly invocation prepares one visible-assistant turn.

The assembly starts with:
- assistant identity inputs
- product-owned shaping inputs
- optional session / continuation inputs
- optional memory candidates
- optional backstage enrichment candidates
- optional live contextual inputs
- optional guardrail overlays

The assembly ends with exactly one `TurnContextAssembly`.

That output is then consumed by:
- `@agent-assistant/harness`, or
- product code using the same projection model

The assembly step itself is pure orchestration logic. It does not call the model or execute tools.

---

## 4. Interfaces and contracts

### 4.1 `TurnContextAssembler`

```typescript
export interface TurnContextAssembler {
  assemble(input: TurnContextInput): Promise<TurnContextAssembly>;
}
```

### 4.2 `TurnContextInput`

```typescript
import type { TraitsProvider } from '@agent-assistant/traits';
import type { HarnessContinuation } from '@agent-assistant/harness';

export interface TurnContextInput {
  assistantId: string;
  turnId: string;
  sessionId?: string;
  userId?: string;
  threadId?: string;

  identity: TurnIdentityInput;
  shaping?: TurnShapingInput;
  session?: TurnSessionInput;
  memory?: TurnMemoryInput;
  enrichment?: TurnEnrichmentInput;
  guardrails?: TurnGuardrailInput;
  continuation?: HarnessContinuation;
  metadata?: Record<string, unknown>;
}
```

### 4.3 `TurnIdentityInput`

```typescript
export interface TurnIdentityInput {
  assistantName?: string;
  traits?: TraitsProvider;

  /**
   * Product-owned base guidance that expresses the assistant's stable identity
   * beyond traits, without making turn-context own persona systems.
   */
  baseInstructions?: {
    systemPrompt?: string;
    developerPrompt?: string;
  };
}
```

### 4.4 `TurnShapingInput`

```typescript
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
```

### 4.5 `TurnSessionInput`

```typescript
export interface TurnSessionInput {
  state?: 'cold' | 'active' | 'resumed';
  summary?: string;
  recentUnresolvedQuestions?: string[];
  conversationalMomentum?: 'low' | 'medium' | 'high';
  surfaceId?: string;
  surfaceType?: string;
}
```

### 4.6 `TurnMemoryInput`

```typescript
export interface TurnMemoryInput {
  candidates?: TurnMemoryCandidate[];
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
```

### 4.7 `TurnEnrichmentInput`

```typescript
export interface TurnEnrichmentInput {
  candidates?: TurnEnrichmentCandidate[];
}

export interface TurnEnrichmentCandidate {
  id: string;
  kind:
    | 'specialist_memo'
    | 'handoff'
    | 'review'
    | 'workspace_state'
    | 'external_snapshot'
    | 'culture_context'
    | 'tool_observation'
    | 'other';

  source: string;
  title?: string;
  content: string;
  importance?: 'low' | 'medium' | 'high';
  confidence?: number;
  freshness?: 'stale' | 'recent' | 'current';
  audience?: 'assistant' | 'product' | 'mixed';
  metadata?: Record<string, unknown>;
}
```

### 4.8 `TurnGuardrailInput`

```typescript
export interface TurnGuardrailInput {
  overlays?: TurnGuardrailOverlay[];
}

export interface TurnGuardrailOverlay {
  id: string;
  source: string;
  rule: string;
  priority?: 'low' | 'medium' | 'high';
  kind?:
    | 'tone_constraint'
    | 'sensitivity_constraint'
    | 'truthfulness_constraint'
    | 'channel_constraint'
    | 'identity_preservation'
    | 'other';
}
```

### 4.9 `TurnExpressionProfile`

```typescript
export interface TurnExpressionProfile {
  tone?: string;
  directness?: 'low' | 'medium' | 'high';
  warmth?: 'low' | 'medium' | 'high';
  humor?: 'off' | 'light' | 'normal';
  initiative?: 'low' | 'medium' | 'high';
  explanationDensity?: 'low' | 'medium' | 'high';
}
```

This profile is intentionally lightweight in v1. It exists so expression can be carried structurally instead of only through prompt text.

---

## 5. Assembly output

### 5.1 `TurnContextAssembly`

```typescript
import type {
  HarnessInstructions,
  HarnessPreparedContext,
} from '@agent-assistant/harness';

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
```

### 5.2 `TurnIdentityProjection`

```typescript
export interface TurnIdentityProjection {
  assistantName?: string;
  traitsApplied: boolean;
  identitySummary: string[];
}
```

### 5.3 `TurnInstructionBundle`

```typescript
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
```

### 5.4 `TurnPreparedContext`

```typescript
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
```

### 5.5 `TurnContextProvenance`

```typescript
export interface TurnContextProvenance {
  usedMemoryIds: string[];
  usedEnrichmentIds: string[];
  usedGuardrailIds: string[];
  droppedEnrichmentIds?: string[];
}
```

---

## 6. Normative behavior

### 6.1 Identity precedence

The assembler:
- MUST treat `identity` inputs as the stable base layer
- MUST NOT let runtime enrichment overwrite base identity
- MAY let shaping or guardrails modulate expression on a turn
- MUST preserve a recognizable identity floor in the resulting assembly

### 6.2 Enrichment handling

The assembler:
- MAY include zero or more enrichment candidates
- MUST preserve source provenance for included enrichment
- MUST treat enrichment as advisory context, not identity replacement
- SHOULD omit low-value or conflicting enrichment rather than forcing it into every turn

### 6.3 Guardrail handling

The assembler:
- MAY incorporate guardrail overlays into effective instructions
- MUST NOT claim guardrail overlays are policy decisions
- SHOULD make guardrail influence inspectable via provenance or instruction segments

### 6.4 Harness compatibility

The assembler:
- MUST provide a deterministic `harnessProjection`
- MUST project to `HarnessInstructions` and `HarnessPreparedContext`
- MUST allow products to feed the result directly into `@agent-assistant/harness` without extra semantic assembly work

### 6.5 Product ownership preservation

The assembler:
- MUST allow product code to author shaping inputs and overlays
- MUST NOT require products to surrender prompt authorship to the SDK
- MUST remain generic across Sage, MSD, NightCTO, and future consumers

---

## 7. Recommended adapter seams

A useful v1 implementation may expose the following optional interfaces.

### 7.1 `TurnMemoryProjector`

```typescript
export interface TurnMemoryProjector {
  project(input: TurnMemoryInput, context: TurnContextInput): Promise<TurnPreparedContextBlock[]>;
}
```

### 7.2 `TurnEnrichmentProjector`

```typescript
export interface TurnEnrichmentProjector {
  project(input: TurnEnrichmentInput, context: TurnContextInput): Promise<TurnPreparedContextBlock[]>;
}
```

### 7.3 `TurnInstructionComposer`

```typescript
export interface TurnInstructionComposer {
  compose(input: TurnContextInput): Promise<TurnInstructionBundle>;
}
```

These seams are optional but consistent with the package boundary. They let products keep domain logic while reusing the overall assembly shape.

---

## 8. Relationship to existing harness types

`HarnessPreparedContext` is already present in `@agent-assistant/harness`:

```typescript
export interface HarnessPreparedContext {
  blocks: HarnessContextBlock[];
  structured?: Record<string, unknown>;
}
```

That type is a **consumer-facing payload shape** for harness.
It is not sufficient by itself to define the missing primitive because it does not represent:
- identity inputs
- expression profile
- instruction segmentation
- provenance
- product shaping overlays

Therefore, v1 `@agent-assistant/turn-context` should:
- keep its own richer assembly type
- provide explicit projection into harness types
- avoid moving turn assembly logic into harness

---

## 9. In-scope examples

### Example A — identity + product shaping only

A product provides:
- traits
- base system prompt
- a per-turn overlay: "Be brief and decisive for this code-review turn"

Assembly returns:
- expression profile adjusted toward directness
- harness instructions with stable identity + turn overlay
- minimal context blocks

### Example B — memory-enriched turn

A product provides:
- traits
- retrieved user/workspace memory candidates
- a resumed session summary

Assembly returns:
- memory-derived context blocks
- continuity-aware instruction bundle
- harness projection ready for `runTurn`

### Example C — backstage-enriched turn

A product provides:
- traits
- specialist memo from coordination
- workspace-state observation
- guardrail overlay: "do not present speculative review findings as fact"

Assembly returns:
- assistant-facing enrichment blocks with provenance
- guardrail segments in effective instructions
- unchanged stable identity layer

---

## 10. Non-goals

This package does **not** provide:
- prompt generation from traits alone
- autonomous enrichment discovery
- relevance ranking guarantees across all domains
- dynamic workforce persona selection
- policy evaluation
- memory retrieval APIs
- coordination execution
- tool execution or routing

It also does not define:
- any product's exact prompt text
- any product's humor policy
- any product's business escalation semantics

---

## 11. Definition of done for implementation

A first implementation is complete when:

1. `packages/turn-context/` exists
2. The package exports the types in this spec or equivalent bounded forms
3. A `createTurnContextAssembler(...)` factory exists
4. The implementation can assemble a `TurnContextAssembly`
5. The implementation can project to harness-compatible `instructions` and `context`
6. Tests prove:
   - identity is preserved when enrichment is present
   - provenance survives projection
   - guardrail overlays shape instructions without becoming policy
   - empty-memory / empty-enrichment inputs still produce valid output
   - products can supply their own overlays without SDK-owned prompt logic taking over
7. README/examples show one end-to-end path from product inputs to harness invocation

---

## 12. Final contract statement

`@agent-assistant/turn-context` is the missing runtime primitive for Agent Assistant.

Its contract is:

> assemble stable identity, product shaping, continuity inputs, memory candidates, backstage enrichment, and guardrail overlays into a visible-assistant turn bundle that preserves identity, exposes provenance, and projects cleanly into harness-ready instructions and prepared context.
