# v1 Turn-Context — Package Implementation Plan

**Date:** 2026-04-13
**Status:** IMPLEMENTATION_PLAN_READY
**Package:** `@agent-assistant/turn-context`
**Version target:** v0.1.0
**Controlling scope:** `docs/architecture/v1-turn-context-implementation-boundary.md`
**Spec anchor:** `docs/specs/v1-turn-context-enrichment-spec.md`
**Review anchor:** `docs/architecture/v1-turn-context-implementation-review-verdict.md`

---

## 1. Package and file layout

### 1.1 Package root: `packages/turn-context/`

```
packages/turn-context/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    # public barrel export
    types.ts                    # all input/output type definitions
    assembler.ts                # createTurnContextAssembler factory + default implementation
    assembler.test.ts           # primary test suite
    validation.ts               # input validation helpers
    projection.ts               # harness projection logic (TurnContextAssembly -> HarnessInstructions + HarnessPreparedContext)
    expression.ts               # expression resolution logic (traits + shaping -> TurnExpressionProfile)
    identity.ts                 # identity projection logic (traits + base instructions -> TurnIdentityProjection)
```

### 1.2 `package.json`

```json
{
  "name": "@agent-assistant/turn-context",
  "version": "0.1.0",
  "description": "Turn-scoped context assembly for Agent Assistant SDK",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agent-assistant/traits": "file:../traits",
    "@agent-assistant/harness": "file:../harness"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/AgentWorkforce/agent-assistant"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### 1.3 Dependency direction

- `@agent-assistant/turn-context` **imports types from** `@agent-assistant/traits` (`TraitsProvider`)
- `@agent-assistant/turn-context` **imports types from** `@agent-assistant/harness` (`HarnessInstructions`, `HarnessPreparedContext`, `HarnessContinuation`)
- Neither `traits` nor `harness` depend on `turn-context`
- This is a clean one-way dependency; no circular imports

### 1.4 Monorepo registration

Add `"packages/turn-context"` to the root `package.json` workspaces array.

---

## 2. Required public API surface for v1

### 2.1 Primary entry point

```ts
// index.ts exports exactly:
export { createTurnContextAssembler } from './assembler.js';
export type { CreateTurnContextAssemblerOptions } from './assembler.js';

// All types re-exported from types.ts:
export type {
  // Assembler interface
  TurnContextAssembler,

  // Input types
  TurnContextInput,
  TurnIdentityInput,
  TurnShapingInput,
  TurnSessionInput,
  TurnMemoryInput,
  TurnMemoryCandidate,
  TurnEnrichmentInput,
  TurnEnrichmentCandidate,
  TurnGuardrailInput,
  TurnGuardrailOverlay,
  TurnInstructionOverlay,
  TurnExpressionProfile,

  // Output types
  TurnContextAssembly,
  TurnIdentityProjection,
  TurnInstructionBundle,
  TurnInstructionSegment,
  TurnPreparedContext,
  TurnPreparedContextBlock,
  TurnContextProvenance,
} from './types.js';

// Validation error
export { TurnContextValidationError } from './validation.js';
```

### 2.2 Factory function

```ts
export interface CreateTurnContextAssemblerOptions {
  /** Optional custom instruction composer. Default: built-in layered composer. */
  instructionComposer?: InstructionComposer;
  /** Optional custom memory projector. Default: built-in candidate projector. */
  memoryProjector?: MemoryProjector;
  /** Optional custom enrichment projector. Default: built-in candidate projector. */
  enrichmentProjector?: EnrichmentProjector;
}

export interface InstructionComposer {
  compose(input: InstructionComposerInput): TurnInstructionBundle;
}

export interface MemoryProjector {
  project(candidates: TurnMemoryCandidate[]): TurnPreparedContextBlock[];
}

export interface EnrichmentProjector {
  project(candidates: TurnEnrichmentCandidate[]): {
    blocks: TurnPreparedContextBlock[];
    usedIds: string[];
    droppedIds: string[];
  };
}

export function createTurnContextAssembler(
  options?: CreateTurnContextAssemblerOptions,
): TurnContextAssembler;
```

The factory returns the default assembler. Hook interfaces are exported as types so products can implement them later, but the default internal implementations are sufficient for v1.

### 2.3 Assembler interface

```ts
export interface TurnContextAssembler {
  assemble(input: TurnContextInput): Promise<TurnContextAssembly>;
}
```

One method, one input, one output. This is the entire runtime surface.

### 2.4 Type definitions

All types defined in the spec (sections 4.1–5.5) are implemented in `types.ts`. The types are listed in section 2.1 above. No deviations from the spec type shapes are planned.

Key required fields enforced at runtime:
- `TurnContextInput.assistantId` — non-empty string
- `TurnContextInput.turnId` — non-empty string
- `TurnContextInput.identity` — object present
- `TurnContextInput.identity.baseInstructions` — object present, at least one of `systemPrompt` or `developerPrompt` non-empty
- `TurnContextInput.shaping` — object present (all nested fields optional)

---

## 3. Internal implementation modules

### 3.1 `validation.ts`

A small validation helper that checks required input constraints and throws `TurnContextValidationError` on failure.

```ts
export class TurnContextValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`TurnContext validation failed: ${field} — ${reason}`);
    this.name = 'TurnContextValidationError';
  }
}

export function validateTurnContextInput(input: TurnContextInput): void;
```

Validates:
- `assistantId` and `turnId` are non-empty strings
- `identity` is present
- `identity.baseInstructions` is present with at least one prompt
- `shaping` is present

This is a local function, not a framework. It throws on first failure.

### 3.2 `identity.ts`

Resolves `TurnIdentityInput` (including optional `TraitsProvider`) into `TurnIdentityProjection`.

```ts
export function resolveIdentity(input: TurnIdentityInput): TurnIdentityProjection;
```

Rules:
- Sets `traitsApplied: true` when `input.traits` contributed defaults
- Builds `identitySummary` from assistant name, traits voice/formality/domain, and base instruction presence
- Summary is an array of short structural strings, not rendered prompt text

### 3.3 `expression.ts`

Resolves the effective `TurnExpressionProfile` for the turn.

```ts
export function resolveExpression(
  traits: TraitsProvider | undefined,
  shaping: TurnShapingInput | undefined,
  session: TurnSessionInput | undefined,
  guardrails: TurnGuardrailInput | undefined,
): TurnExpressionProfile;
```

Resolution order (per spec section 5.4):
1. Start from traits-derived defaults when available (e.g. `voice: 'concise'` -> `directness: 'high'`)
2. Apply `shaping.expressionOverrides` — these win over trait defaults
3. Apply session-derived nudges (e.g. `state: 'cold'` may lower `explanationDensity` default)
4. Apply guardrail downgrades (e.g. `tone_constraint` with `priority: 'high'` can cap `humor` to `'off'`)

The mapping from trait values to expression defaults is a small lookup table, not a heuristic engine.

### 3.4 `projection.ts`

Renders the internal assembly into `HarnessInstructions` + `HarnessPreparedContext`.

```ts
export function projectToHarness(
  instructions: TurnInstructionBundle,
  context: TurnPreparedContext,
  responseStyle: TurnShapingInput['responseStyle'],
): {
  instructions: HarnessInstructions;
  context: HarnessPreparedContext;
};
```

Rules:
- `systemSegments` are concatenated (ordered by priority then source order) into `HarnessInstructions.systemPrompt`
- `developerSegments` are concatenated into `HarnessInstructions.developerPrompt`
- Guardrail segments are appended to the developer prompt section
- `TurnPreparedContextBlock[]` maps directly to `HarnessContextBlock[]` (the shapes are compatible by design)
- `responseStyle` is passed through when present

### 3.5 `assembler.ts`

The default assembler implementation. Composes the above modules in this order:

1. Validate input
2. Resolve identity
3. Resolve expression
4. Compose instruction bundle (base instructions -> shaping overlays -> guardrails)
5. Project memory candidates into context blocks
6. Project enrichment candidates into context blocks
7. Project session input into context block (if present)
8. Build provenance
9. Project to harness format
10. Return `TurnContextAssembly`

The assembler is async to allow future hook implementations to be async, but the v1 default path is synchronous internally.

---

## 4. Test plan

Tests live in `src/assembler.test.ts` and use vitest. The test suite must prove the primitive is useful and not just string concatenation.

### 4.1 Required validation tests

| Test | What it proves |
|------|---------------|
| Rejects missing `assistantId` | Required field enforcement |
| Rejects missing `turnId` | Required field enforcement |
| Rejects missing `identity` | Required field enforcement |
| Rejects missing `identity.baseInstructions` | Required field enforcement |
| Rejects `baseInstructions` with neither system nor developer prompt | At-least-one-prompt rule |
| Rejects missing `shaping` | Required field enforcement |
| Accepts minimal valid input | Happy path baseline |

### 4.2 Required identity tests

| Test | What it proves |
|------|---------------|
| `traitsApplied` is `false` when no traits provided | Correct provenance tracking |
| `traitsApplied` is `true` when traits provided | Correct provenance tracking |
| `identitySummary` includes assistant name when provided | Structural summary correctness |
| `identitySummary` reflects traits voice and domain | Summary is derived from real data |

### 4.3 Required expression resolution tests

| Test | What it proves |
|------|---------------|
| Default expression when no traits or overrides | Sensible defaults exist |
| Traits-derived expression defaults | Traits inform expression structurally |
| `expressionOverrides` override trait defaults | Shaping takes precedence over traits |
| Guardrail downgrades cap expression fields | Guardrails constrain, not replace |
| Session state influences expression | Session-awareness works |

### 4.4 Required instruction composition tests

| Test | What it proves |
|------|---------------|
| Base system prompt appears in system segments | Identity floor preserved |
| Base developer prompt appears in developer segments | Identity floor preserved |
| Instruction overlays are ordered by priority | Deterministic ordering |
| Guardrail overlays appear after instruction overlays | Layer order correct |
| Unspecified priority treated as `medium` | Default priority behavior |

### 4.5 Required context projection tests

| Test | What it proves |
|------|---------------|
| Memory candidates become context blocks with `category: 'memory'` | Memory projection works |
| Enrichment candidates become context blocks with `category: 'enrichment'` | Enrichment projection works |
| Session input becomes a context block with `category: 'session'` | Session projection works |
| Source metadata preserved on projected blocks | Provenance carried through |
| Empty candidates produce empty blocks (no phantom content) | No hallucinated context |

### 4.6 Required provenance tests

| Test | What it proves |
|------|---------------|
| `usedMemoryIds` reflects included memory candidates | Provenance accuracy |
| `usedEnrichmentIds` reflects included enrichment candidates | Provenance accuracy |
| `usedGuardrailIds` reflects applied guardrails | Provenance accuracy |
| `droppedEnrichmentIds` reflects excluded candidates | Drop tracking works |

### 4.7 Required harness projection tests — the proof that matters

These tests prove that `turn-context` is a real upstream primitive for harness, not a detached type exercise.

| Test | What it proves |
|------|---------------|
| `harnessProjection.instructions` is a valid `HarnessInstructions` | Type compatibility with harness |
| `harnessProjection.context` is a valid `HarnessPreparedContext` | Type compatibility with harness |
| System prompt in harness projection contains identity floor | Identity survives projection |
| Developer prompt in harness projection contains shaping + guardrails | Shaping survives projection |
| Context blocks in harness projection contain memory + enrichment | Enrichment survives projection |
| Full assembly can be destructured into a valid `HarnessTurnInput` shape | Consumer path works end-to-end |

### 4.8 Integration-style assembly test

One test that exercises the full pipeline with realistic inputs:

```ts
test('full assembly: identity + traits + shaping + memory + enrichment + guardrails -> harness-ready output', async () => {
  const assembler = createTurnContextAssembler();
  const assembly = await assembler.assemble({
    assistantId: 'sage',
    turnId: 'turn-001',
    sessionId: 'session-abc',
    userId: 'user-xyz',
    identity: {
      assistantName: 'Sage',
      traits: createTraitsProvider({
        voice: 'concise',
        formality: 'professional',
        proactivity: 'medium',
        riskPosture: 'moderate',
      }),
      baseInstructions: {
        systemPrompt: 'You are Sage, a workspace assistant.',
        developerPrompt: 'Keep answers focused and actionable.',
      },
    },
    shaping: {
      mode: 'review',
      instructionOverlays: [
        { id: 'ov-1', source: 'product', text: 'Emphasize key risks.', priority: 'high' },
      ],
      expressionOverrides: { directness: 'high' },
    },
    memory: {
      candidates: [
        { id: 'mem-1', text: 'User prefers bullet points.', scope: 'user', relevance: 0.9, freshness: 'current' },
      ],
    },
    enrichment: {
      candidates: [
        { id: 'enr-1', kind: 'specialist_memo', source: 'reviewer', content: 'PR has 2 critical issues.', importance: 'high', freshness: 'current' },
      ],
    },
    guardrails: {
      overlays: [
        { id: 'gr-1', source: 'workspace', rule: 'Do not speculate about unverified findings.', kind: 'truthfulness_constraint', priority: 'high' },
      ],
    },
  });

  // Structural assertions
  expect(assembly.assistantId).toBe('sage');
  expect(assembly.identity.traitsApplied).toBe(true);
  expect(assembly.expression.directness).toBe('high');
  expect(assembly.provenance.usedMemoryIds).toContain('mem-1');
  expect(assembly.provenance.usedEnrichmentIds).toContain('enr-1');
  expect(assembly.provenance.usedGuardrailIds).toContain('gr-1');

  // Harness projection assertions
  expect(assembly.harnessProjection.instructions.systemPrompt).toContain('You are Sage');
  expect(assembly.harnessProjection.context.blocks.length).toBeGreaterThan(0);

  // Consumer path assertion: this should type-check against HarnessTurnInput shape
  const turnInput = {
    assistantId: assembly.assistantId,
    turnId: assembly.turnId,
    sessionId: assembly.sessionId,
    userId: assembly.userId,
    message: { id: 'msg-1', text: 'Review this PR.', receivedAt: new Date().toISOString() },
    instructions: assembly.harnessProjection.instructions,
    context: assembly.harnessProjection.context,
  };
  expect(turnInput.instructions.systemPrompt).toBeTruthy();
});
```

This test proves the primitive is useful by exercising the full assembly from realistic product-like inputs through to a harness-consumable output.

---

## 5. Harness projection proof requirement

The implementation is not considered complete until the following is demonstrably true:

### 5.1 Type-level proof

`assembly.harnessProjection.instructions` must satisfy `HarnessInstructions` from `@agent-assistant/harness`.
`assembly.harnessProjection.context` must satisfy `HarnessPreparedContext` from `@agent-assistant/harness`.

This is enforced by the TypeScript compiler via explicit type annotations in `projection.ts`.

### 5.2 Behavioral proof

The integration test (section 4.8) must demonstrate that:
1. A realistic multi-source assembly produces a non-trivial harness projection
2. The system prompt preserves the identity floor
3. Context blocks carry enrichment with source metadata
4. The output can be destructured into a `HarnessTurnInput`-shaped object without transformation

### 5.3 No semantic gap proof

The consumer path must work with **zero intermediate processing**:

```ts
const assembly = await assembler.assemble(input);
// This must work directly — no adapter, no reshaping, no lossy conversion:
harness.runTurn({
  ...ids,
  message,
  instructions: assembly.harnessProjection.instructions,
  context: assembly.harnessProjection.context,
});
```

If any field requires transformation between assembly output and harness input, that is a bug in the projection, not a product responsibility.

---

## 6. What is intentionally deferred

### 6.1 Deferred even if tempting in v1

| Deferred item | Why it is tempting | Why it is deferred |
|---|---|---|
| **Memory retrieval or ranking** | Assembler touches memory candidates | Memory retrieval is a separate subsystem; assembler only projects pre-selected candidates |
| **Specialist orchestration** | Enrichment candidates come from specialists | Orchestration belongs to `@agent-assistant/coordination`; assembler only packages results |
| **Policy evaluation** | Guardrails feel like policy | Guardrails shape expression; policy decides allow/deny — different primitives |
| **Advanced conflict resolution** | Overlapping overlays may contradict | V1 uses priority ordering only; semantic conflict resolution requires product evidence first |
| **Prompt template rendering engine** | Segments need rendering into final prompt | V1 concatenates segments with separators; a template engine is premature abstraction |
| **Token counting or budget awareness** | Products care about prompt size | Token counting depends on model; assembler is model-agnostic in v1 |
| **Caching or memoization** | Repeated assemblies for same context | No evidence of hot-path performance need yet; optimize when measured |
| **Streaming or incremental assembly** | Large enrichment sets may arrive incrementally | V1 is one-shot assembly; streaming adds complexity with no proven consumer need |
| **Public sub-interfaces for each resolution step** | Clean internal decomposition | Internal modules exist but are not public API; expose only when consumers need to replace them |
| **Expression-to-prompt rendering** | Expression profile should influence prompt text | V1 carries expression structurally; prompt rendering from expression fields is product-owned |
| **Session recap or continuity intelligence** | Session input feels like it should drive conversation recap | V1 only carries session state into lightweight context blocks; recap heuristics are product-owned |
| **Enrichment salience scoring** | Candidates have `relevance` and `importance` | V1 includes all candidates; salience-based filtering is a future optimization |
| **Adapter registry for projector hooks** | Factory accepts optional hooks | V1 ships with working defaults; hook infrastructure only matters when products override |

### 6.2 Deferred package integrations

- **`@agent-assistant/memory`** — blocked on upstream; turn-context accepts pre-retrieved candidates only
- **`@agent-assistant/coordination`** — turn-context accepts pre-packaged enrichment candidates only
- **`@agent-assistant/connectivity`** — backstage signals arrive as enrichment candidates, not as a direct import
- **`@agent-assistant/policy`** — guardrail overlays are authored by products using policy outputs; no direct import

### 6.3 Deferred documentation

- README.md for the package — write after implementation is proven
- Public API docs — TypeScript types are self-documenting for v1
- Migration guide — no existing consumers to migrate

---

## 7. Implementation order

### Pass 1 — types and validation
1. Create `packages/turn-context/` directory structure
2. Write `package.json`, `tsconfig.json`, `vitest.config.ts`
3. Implement `types.ts` — all input/output type definitions
4. Implement `validation.ts` — input validation with `TurnContextValidationError`
5. Register workspace in root `package.json`

### Pass 2 — resolution modules
6. Implement `identity.ts` — identity projection from traits + base instructions
7. Implement `expression.ts` — expression resolution with trait defaults, shaping overrides, guardrail downgrades
8. Implement `projection.ts` — harness projection rendering

### Pass 3 — assembler
9. Implement `assembler.ts` — factory + default assembler composing all modules
10. Implement `index.ts` — public barrel export

### Pass 4 — tests
11. Write validation tests
12. Write identity tests
13. Write expression tests
14. Write instruction composition tests
15. Write context projection tests
16. Write provenance tests
17. Write harness projection tests
18. Write full integration assembly test

### Pass 5 — build verification
19. `npm install` from root
20. `npm run build` in `packages/turn-context`
21. `npm test` in `packages/turn-context`
22. Verify TypeScript compilation catches any harness/traits type mismatches

---

## 8. Success criteria

The v1 implementation is complete when:

1. All types from the spec are implemented and exported
2. `createTurnContextAssembler()` returns a working assembler
3. The assembler validates required inputs and rejects invalid ones
4. Identity, expression, instruction, and context assembly produce correct structured outputs
5. `harnessProjection` output satisfies `HarnessInstructions` and `HarnessPreparedContext` types
6. Provenance tracks which candidates were used
7. All tests in section 4 pass
8. The full integration test demonstrates a realistic multi-source assembly
9. `npm run build` succeeds with zero type errors
10. No runtime dependencies beyond `@agent-assistant/traits` and `@agent-assistant/harness` (type-only imports from harness are acceptable)

---

V1_TURN_CONTEXT_PACKAGE_IMPLEMENTATION_PLAN_READY
