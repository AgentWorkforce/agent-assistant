# v1 Turn-Context — Implementation Boundary

Date: 2026-04-13
Status: V1_TURN_CONTEXT_IMPLEMENTATION_BOUNDARY_READY
Spec anchor: `docs/specs/v1-turn-context-enrichment-spec.md`
Boundary anchor: `docs/architecture/v1-turn-context-enrichment-boundary.md`
Runtime map anchor: `docs/architecture/agent-assistant-runtime-primitive-map.md`
Harness anchor: `docs/specs/v1-harness-spec.md`

---

## 1. Goal of the first implementation milestone

The first implementation milestone of `@agent-assistant/turn-context` should deliver the **smallest package that is already useful to a real assistant product** and that can feed `@agent-assistant/harness` with no extra semantic assembly step.

That means v1 is **not** a generic prompt engine, not a memory system, not a policy engine, and not a product-intelligence layer.

It is one thing only:

> given stable assistant identity, one turn situation, product-authored shaping, and optional enrichment / guardrail overlays, produce one deterministic turn assembly plus a harness-ready projection.

The implementation milestone should optimize for:
- one obvious primary entry point
- deterministic composition rules
- minimal but inspectable provenance
- clean dependency direction relative to `traits`, `harness`, and product code
- a proving path that looks like a real product turn, not a toy string helper

---

## 2. Exact v1 implementation shape

### Primary public surface

V1 should ship a **single primary factory + runtime interface**:

```ts
export interface TurnContextAssembler {
  assemble(input: TurnContextInput): Promise<TurnContextAssembly>;
}

export function createTurnContextAssembler(
  options?: CreateTurnContextAssemblerOptions,
): TurnContextAssembler;
```

The default assembler is the v1 product.

### Why this is the right minimum

This keeps the package usable immediately:
- products can instantiate one assembler
- pass one input object
- receive one assembly object
- hand `assembly.harnessProjection` directly to harness

It avoids overbuilding v1 into a graph of independently configurable subsystems before there is evidence that consumers need that complexity.

### Optional constructor options allowed in v1

V1 may accept **narrow optional hooks** for projection/composition customization, but only behind the main factory:
- `instructionComposer?`
- `memoryProjector?`
- `enrichmentProjector?`

These are extension seams for products or later reusable adapters.
They are **not** separate first-class products in the first pass.

If these hooks add complexity during implementation, the first pass may ship with only the default internal behavior and the hook types exported for later use.

---

## 3. Required v1 inputs

V1 should be strict about which inputs are truly required for usefulness.

### 3.1 Top-level required fields

The following `TurnContextInput` fields are required in v1:

```ts
interface TurnContextInput {
  assistantId: string;
  turnId: string;
  identity: TurnIdentityInput;
  shaping: TurnShapingInput;
}
```

`identity` and `shaping` must both be required in the implementation, even if some nested fields remain optional.

### 3.2 Required identity inputs

V1 requires:

```ts
interface TurnIdentityInput {
  assistantName?: string;
  traits?: TraitsProvider;
  baseInstructions: {
    systemPrompt?: string;
    developerPrompt?: string;
  };
}
```

#### Rules
- `baseInstructions` is required, because v1 must have a stable product-authored identity floor even when no traits are present.
- At least one of `baseInstructions.systemPrompt` or `baseInstructions.developerPrompt` must be present.
- `traits` remains optional because some products may still use only product-local identity shaping.
- `assistantName` remains optional because not every harness path needs it structurally.

### 3.3 Required shaping inputs

V1 requires:

```ts
interface TurnShapingInput {
  mode?: string;
  instructionOverlays?: TurnInstructionOverlay[];
  expressionOverrides?: Partial<TurnExpressionProfile>;
  responseStyle?: {
    preferMarkdown?: boolean;
    maxAnswerChars?: number;
  };
}
```

#### Rules
- The `shaping` object itself is required.
- All nested shaping fields may be omitted.
- Requiring the object makes the product explicitly opt into turn-scoped shaping, even if the first turn uses an empty object.

This is the minimum useful distinction between:
- stable identity floor, and
- turn-specific product intent.

### 3.4 Optional but supported in v1

The following inputs are supported in v1 but not required:
- `session?: TurnSessionInput`
- `memory?: TurnMemoryInput`
- `enrichment?: TurnEnrichmentInput`
- `guardrails?: TurnGuardrailInput`
- `continuation?: HarnessContinuation`
- `sessionId?`, `userId?`, `threadId?`, `metadata?`

### 3.5 What v1 must actually do with the optional inputs

#### `session`
V1 may use session inputs only to:
- add a session-derived context block
- slightly shape expression defaults (for example resumed vs cold)
- carry session identifiers into the output

It must **not** implement conversation-state policy, recap heuristics, or continuity intelligence beyond this lightweight shaping.

#### `memory`
V1 must support **candidate projection only**:
- accept memory candidates already chosen by product or memory code
- include a bounded subset as prepared context blocks
- record which candidate ids were used

It must **not** retrieve memory, rank memory with advanced heuristics, or mutate memory.

#### `enrichment`
V1 must support **candidate projection only**:
- accept backstage enrichment candidates already chosen upstream
- include assistant-appropriate candidates as prepared context blocks
- record used and dropped enrichment ids

It must **not** orchestrate specialists, fetch live data, or compute salience through a large scoring subsystem.

#### `guardrails`
V1 must support **minimal overlays only**:
- append guardrail-derived instruction segments
- optionally expose a guardrail summary in provenance/identity summary
- preserve inspectability of which guardrails were applied

It must **not** evaluate policy or decide allow/deny/approval outcomes.

#### `continuation`
V1 only needs to:
- preserve it as an input to assembly decisions if needed
- optionally add continuation-awareness to context or identity summary
- remain compatible with the harness turn input shape

It must **not** own continuation lifecycle or persistence.

---

## 4. Required v1 outputs

V1 must always produce these outputs:

```ts
interface TurnContextAssembly {
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

### 4.1 Identity output required in v1

V1 must output:

```ts
interface TurnIdentityProjection {
  assistantName?: string;
  traitsApplied: boolean;
  identitySummary: string[];
}
```

#### Required behavior
- `traitsApplied` must be `true` when traits contributed any identity defaults.
- `identitySummary` must contain a lightweight human-inspectable summary of what identity floor was assembled.
- The summary should stay short and structural; it is not a rendered prompt transcript.

### 4.2 Effective behavior output required in v1

`expression: TurnExpressionProfile` is required in every assembly.

V1 must always return an expression object, even if mostly empty/defaulted.
This is the main structured output proving that turn-context is more than prompt concatenation.

At minimum, v1 must be able to carry:
- tone
- directness
- warmth
- humor
- initiative
- explanationDensity

### 4.3 Prepared context output required in v1

`context.blocks` is required and may be empty.

`context.structured` is optional.

V1 must project any included memory/session/enrichment material into `TurnPreparedContextBlock[]` with source/category metadata preserved.

### 4.4 Harness projection output required in v1

`harnessProjection` is mandatory.

V1 must deterministically render:
- `TurnInstructionBundle` → `HarnessInstructions`
- `TurnPreparedContext` → `HarnessPreparedContext`

So the consumer path can do this with no extra semantic step:

```ts
const assembly = await assembler.assemble(input);
await harness.runTurn({
  assistantId: input.assistantId,
  turnId: input.turnId,
  sessionId: input.sessionId,
  userId: input.userId,
  threadId: input.threadId,
  message,
  instructions: assembly.harnessProjection.instructions,
  context: assembly.harnessProjection.context,
  continuation: input.continuation,
});
```

### 4.5 Lightweight provenance required in v1

V1 provenance must stay small:

```ts
interface TurnContextProvenance {
  usedMemoryIds: string[];
  usedEnrichmentIds: string[];
  usedGuardrailIds: string[];
  droppedEnrichmentIds?: string[];
}
```

This is enough to make assembly inspectable without creating a full runtime trace subsystem.

---

## 5. Included v1 resolution and priority logic

The first pass should include only the resolution logic that is necessary for deterministic, product-useful assembly.

## 5.1 Layer order

V1 must compose in this order:

1. **Base identity floor**
   - `identity.baseInstructions`
   - `identity.traits`
2. **Turn shaping**
   - `shaping.mode`
   - `shaping.instructionOverlays`
   - `shaping.expressionOverrides`
   - `shaping.responseStyle`
3. **Optional contextual additions**
   - `session`
   - `memory`
   - `enrichment`
4. **Guardrail overlays**
   - appended last as shaping constraints, not policy decisions
5. **Harness projection rendering**

## 5.2 Identity precedence

V1 must implement these rules:
- base identity is the non-overridable floor
- traits may refine identity defaults, but do not replace product-authored base instructions
- turn shaping may modulate expression, but may not redefine who the assistant is
- enrichment may inform context and expression, but may not rewrite identity
- guardrails may constrain expression, but may not become a substitute identity source

In short:

> identity is durable, shaping is turn-scoped, enrichment is advisory, guardrails are constraining.

## 5.3 Instruction precedence

When building `TurnInstructionBundle`, v1 must order instruction segments as:

1. base system segments
2. base developer segments
3. product instruction overlays sorted by priority
4. guardrail segments sorted by priority

### Required priority behavior

For v1, `priority` only needs deterministic ordering:
- `high`
- `medium`
- `low`
- unspecified treated as `medium`

V1 does **not** need semantic conflict resolution beyond ordering.
If two overlays conflict, the package may preserve both and rely on upstream product authorship to avoid contradictions.

## 5.4 Expression resolution

V1 expression resolution must be shallow and deterministic:

1. start from traits-derived defaults when available
2. apply session-derived soft adjustments only if obvious and local
3. apply shaping `expressionOverrides`
4. apply guardrail-constrained downgrades where directly supported

Examples of allowed guardrail-constrained downgrades in v1:
- reduce humor from `normal` to `light` or `off`
- reduce warmth/directness if a tone constraint says formal/serious

V1 must not implement a broad natural-language rules engine for expression transformation.

## 5.5 Candidate projection rules

### Memory candidates
V1 may use simple inclusion rules such as:
- preserve input order
- optionally prefer higher `relevance`
- cap to a small fixed number of blocks

### Enrichment candidates
V1 may use simple inclusion rules such as:
- ignore clearly product-only candidates where `audience === 'product'`
- prefer `importance: high` over lower importance
- preserve source provenance
- cap to a small fixed number of blocks

The exact heuristic may be simple, but it must be deterministic and documented in the implementation README/tests.

### Guardrails
V1 must include all provided guardrail overlays unless a guardrail is structurally invalid.
No risk-scoring or deduplication engine is required.

---

## 6. What is intentionally deferred

The first milestone must stay small. The following are intentionally out of scope.

### 6.1 Deferred product-intelligence behaviors

Do not implement in v1:
- domain-specific prompt strategy
- workspace/business heuristics
- dynamic task-mode inference
- outcome-to-UX mapping
- routing/persona selection

### 6.2 Deferred memory/enrichment intelligence

Do not implement in v1:
- memory retrieval
- memory ranking engines
- recency/salience learning
- specialist orchestration
- external fetch pipelines
- enrichment confidence modeling beyond carrying the field through

### 6.3 Deferred prompt/rendering sophistication

Do not implement in v1:
- a general prompt DSL
- segment-level contradiction detection
- token-budget optimizer
- automatic summarization/compression
- model-specific prompt rendering variants

### 6.4 Deferred policy/guardrail sophistication

Do not implement in v1:
- approval decisions
- allow/deny classification
- action governance
- audit sink integration
- policy-derived remediation flows

### 6.5 Deferred package surface expansion

Do not implement in v1 unless the core slice is already complete and trivial to expose:
- a public library of reusable memory projectors
- a public library of reusable enrichment projectors
- multiple assembler classes
- standalone instruction-renderer packagelets
- subpath exports

---

## 7. Proving consumer path required later

The implementation is not truly proven by unit tests alone.
The proving path should be a **realistic harness-backed product-style turn**.

## Required proving path

The first proving consumer should be:

> a product-style assistant flow that assembles turn-context, then immediately calls `@agent-assistant/harness.runTurn(...)` using `assembly.harnessProjection`.

### Minimum proof requirements

1. Build a turn-context input with:
   - base instructions
   - traits or equivalent identity defaults
   - one turn shaping overlay
   - at least one enrichment or memory candidate
   - one minimal guardrail overlay
2. Assemble once through `createTurnContextAssembler()`.
3. Feed the result directly into harness with no extra semantic assembly.
4. Verify that:
   - the harness call shape is sufficient
   - identity survives enrichment
   - response-style hints project correctly
   - provenance is inspectable after the turn

### Recommended proof location

The later proof should live in one of these forms:
- a focused integration test spanning `turn-context` + `harness`, or
- a product-style example under `packages/examples/` once harness wave-2 examples are extended

### What should not count as proof

These are not sufficient by themselves:
- a pure string-rendering unit test
- a test that checks only `TurnInstructionBundle`
- a proof that never passes through harness types
- a mocked product path that reassembles instructions after `assemble()` returns

The whole point of this primitive is to make harness-facing turn assembly reusable and direct.

---

## 8. Expected package/files in the first implementation pass

The first pass should be compact.

```text
packages/turn-context/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    types.ts
    turn-context.ts
    turn-context.test.ts
```

## File responsibilities

### `package.json`
- package identity: `@agent-assistant/turn-context`
- peer/runtime dependency posture consistent with the chosen type-import strategy for `traits` and `harness`
- publish/build fields aligned with existing packages

### `tsconfig.json`
- match repo package conventions
- exclude tests from build output

### `src/index.ts`
- package exports only

### `src/types.ts`
- `TurnContextInput`
- `TurnContextAssembly`
- supporting input/output types
- `TurnContextAssembler`
- any narrow options interfaces needed by the default factory

### `src/turn-context.ts`
- `createTurnContextAssembler()`
- default assembly implementation
- deterministic projection helpers kept package-private unless clearly reusable

### `src/turn-context.test.ts`
Must cover at least:
- required-input validation
- identity floor preserved when enrichment is present
- shaping overrides affect expression without replacing identity
- guardrail overlays flow into instruction bundle
- provenance records used/dropped ids correctly
- harness projection is deterministic and directly consumable
- empty optional inputs still produce a valid assembly

### `README.md`
Must document:
- package purpose
- minimal assembly example
- direct harness projection usage
- clear non-goals so consumers do not mistake this package for memory/policy/product logic

## Files explicitly not required in first pass

Do not require these in the initial milestone:
- `projectors/` directory
- `renderers/` directory
- `errors.ts` unless validation complexity genuinely warrants it
- `integration-tests/` subpackage
- examples beyond the README snippet

If implementation later demonstrates a natural split, that can happen after the first useful milestone exists.

---

## 9. Boundary guardrails for implementation

The implementation pass should reject the following failure modes:

### Failure mode A — harness creep
If the package starts owning model-step assumptions, tool orchestration, or stop semantics, it has crossed into harness.

### Failure mode B — traits creep
If the package starts defining or validating stable identity schemas beyond reading `TraitsProvider`, it has crossed into traits.

### Failure mode C — product-intelligence creep
If the package starts choosing domain heuristics, business behavior, or persona envelopes, it has crossed into product code.

### Failure mode D — memory/coordinator creep
If the package starts retrieving memory, orchestrating specialists, or fetching live enrichment itself, it has crossed into upstream provider concerns.

### Failure mode E — giant prompt subsystem creep
If the package becomes a prompt-authoring framework instead of a turn assembly seam, the milestone is no longer bounded.

---

## 10. Final implementation judgment

The first useful implementation of `@agent-assistant/turn-context` should be:
- one assembler factory
- one deterministic assembly method
- required identity + shaping inputs
- optional session/memory/enrichment/guardrail seams
- structured outputs for identity, expression, context, harness projection, and lightweight provenance
- no retrieval engine, no policy engine, no prompt platform, no product intelligence layer

That is the smallest slice that is already worth integrating into a real assistant product.

V1_TURN_CONTEXT_IMPLEMENTATION_BOUNDARY_READY
