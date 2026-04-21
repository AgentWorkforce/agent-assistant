# `@agent-assistant/turn-context`

Turn-scoped context assembly for the Agent Assistant SDK.

---

## Purpose

`@agent-assistant/turn-context` is the runtime primitive that assembles the effective assistant-facing turn context for one bounded turn.

It sits:
- **above** `@agent-assistant/traits` (consumes stable identity defaults)
- **adjacent to** memory, policy, and coordination inputs
- **below** product-specific prompts and UX logic
- **upstream of** `@agent-assistant/harness`

It answers the question:

> Given this assistant, this session, this turn, these memories, and these backstage signals — what should the visible assistant actually receive as its effective character + context bundle for this turn?

---

## What it owns

- Typed turn-context assembly inputs
- Typed turn-context assembly outputs
- Identity-preserving composition rules
- Provenance-carrying enrichment packaging
- Harness-projection compatibility (`HarnessInstructions` + `HarnessPreparedContext`)

## What it does NOT own

- Model execution or tool execution
- Session persistence or memory retrieval
- Policy evaluation or approval logic
- Specialist orchestration or enrichment discovery
- Product business rules, prompt phrasing, or domain heuristics

---

## Core design rule

> Runtime enrichment informs the assistant's expression for the turn; it does not replace assistant identity.

The assembly output preserves distinct sources:
- stable identity inputs
- product-authored overlays
- runtime enrichment inputs
- guardrail overlays

---

## Installation

```bash
npm install @agent-assistant/turn-context
```

---

## Minimal assembly example

```ts
import { createTurnContextAssembler } from '@agent-assistant/turn-context';

const assembler = createTurnContextAssembler();

const assembly = await assembler.assemble({
  assistantId: 'sage',
  turnId: 'turn-001',
  identity: {
    assistantName: 'Sage',
    baseInstructions: {
      systemPrompt: 'You are Sage, a workspace assistant.',
      developerPrompt: 'Keep answers focused and actionable.',
    },
  },
  shaping: {
    mode: 'review',
    expressionOverrides: { directness: 'high' },
  },
});
```

---

## Direct harness projection — zero transformation needed

```ts
import { createTurnContextAssembler } from '@agent-assistant/turn-context';
import { createHarness } from '@agent-assistant/harness';

const assembler = createTurnContextAssembler();
const harness = createHarness({ model: myModelAdapter });

const assembly = await assembler.assemble(input);

const result = await harness.runTurn({
  assistantId: assembly.assistantId,
  turnId: assembly.turnId,
  sessionId: assembly.sessionId,
  userId: assembly.userId,
  message: incomingMessage,
  instructions: assembly.harnessProjection.instructions,  // direct — no reshaping
  context: assembly.harnessProjection.context,            // direct — no reshaping
  continuation: input.continuation,
});
```

The `harnessProjection` output is always a valid `HarnessInstructions` + `HarnessPreparedContext`. No adapter or transformation is needed between `assemble()` and `harness.runTurn()`.

## Direct execution adapter projection

Products that execute through an `ExecutionAdapter` can project the same assembly into the
canonical `ExecutionRequest` shape with `toExecutionRequest`.

```ts
import {
  createTurnContextAssembler,
  toExecutionRequest,
} from '@agent-assistant/turn-context';

const assembler = createTurnContextAssembler();
const assembly = await assembler.assemble(input);

const request = toExecutionRequest(assembly, incomingMessage, {
  tools: readOnlyToolDescriptors,
  requirements: { toolUse: 'allowed', traceDepth: 'standard' },
  metadata: { route: 'founder-chat' },
});

const negotiation = adapter.negotiate(request);
const result = negotiation.supported
  ? await adapter.execute(request)
  : { status: 'unsupported', degradation: negotiation.reasons };
```

The projection preserves assistant/session/user/thread ids, rendered instructions, context
blocks, response style, message metadata, and optional tools/requirements/continuation metadata.
Execution adapters stay downstream of turn-context; products still own identity and policy.

---

## Multi-source assembly with memory, enrichment, and guardrails

```ts
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
    responseStyle: { preferMarkdown: true },
  },
  memory: {
    // Pre-retrieved candidates from your memory system
    candidates: [
      { id: 'mem-1', text: 'User prefers bullet points.', scope: 'user', relevance: 0.9 },
    ],
  },
  enrichment: {
    // Pre-packaged backstage enrichment from coordination/connectivity
    candidates: [
      {
        id: 'enr-1',
        kind: 'specialist_memo',
        source: 'reviewer',
        content: 'PR has 2 critical issues.',
        importance: 'high',
      },
    ],
  },
  guardrails: {
    overlays: [
      {
        id: 'gr-1',
        source: 'workspace',
        rule: 'Do not speculate about unverified findings.',
        kind: 'truthfulness_constraint',
        priority: 'high',
      },
    ],
  },
});

// Inspect provenance after assembly
console.log(assembly.provenance.usedMemoryIds);     // ['mem-1']
console.log(assembly.provenance.usedEnrichmentIds); // ['enr-1']
console.log(assembly.provenance.usedGuardrailIds);  // ['gr-1']

// Inspect expression profile
console.log(assembly.expression.directness);        // 'high' (from expressionOverrides)
console.log(assembly.expression.humor);             // capped by guardrail if tone_constraint present
```

---

## Composition rules

### Layer order

1. **Base identity floor** — `identity.baseInstructions` + `identity.traits`
2. **Turn shaping** — `shaping.mode`, `shaping.instructionOverlays`, `shaping.expressionOverrides`
3. **Optional contextual additions** — session, memory, enrichment
4. **Guardrail overlays** — appended last as constraining overlays, not policy decisions
5. **Harness projection rendering**

### Identity precedence

- Base identity is the non-overridable floor.
- Traits may refine identity defaults but do not replace product-authored base instructions.
- Turn shaping modulates expression but does not redefine who the assistant is.
- Enrichment informs context but does not rewrite identity.
- Guardrails constrain expression but do not become a substitute identity source.

### Instruction ordering

System segments: `[base-system]` (sorted high→low priority)

Developer segments: `[base-developer, ...instructionOverlays sorted by priority, mode-segment]` + `[...guardrailSegments sorted by priority]` (guardrails appended to developer prompt in harness projection)

### Enrichment candidate inclusion

- Candidates with `audience: 'product'` are excluded from assistant-facing context (tracked in `droppedEnrichmentIds`).
- Remaining candidates sorted by importance descending.
- Capped at 8 enrichment blocks per turn.

### Memory candidate inclusion

- Sorted by `relevance` descending.
- Capped at 10 memory blocks per turn.

---

## Non-goals

This package is **not**:

- A memory engine — it accepts pre-retrieved candidates only
- A policy engine — guardrails shape expression; they do not evaluate allow/deny
- A prompt-management CMS or DSL
- A specialist orchestrator — it accepts pre-packaged enrichment
- A model router or persona system
- A product-intelligence layer or domain heuristic system
- A replacement for product prompt craftsmanship

Products still own:
- exact prompt text and prompt-stack authoring
- domain-specific enrichment ranking and selection
- which backstage agents exist and what their outputs mean
- business and commercial escalation logic
- product-specific policy rules and integration credentials

---

## API reference

### `createTurnContextAssembler(options?)`

Returns a `TurnContextAssembler`.

```ts
const assembler = createTurnContextAssembler();
```

### `assembler.assemble(input: TurnContextInput): Promise<TurnContextAssembly>`

Assembles one turn context. Validates required inputs and throws `TurnContextValidationError` on failure.

**Required inputs:**
- `assistantId` — non-empty string
- `turnId` — non-empty string
- `identity` — object with `baseInstructions` present; at least one of `systemPrompt` or `developerPrompt` must be a non-empty string

**Optional inputs:**
- `shaping` — turn-scoped product behavioral shaping
- `session` — session continuity signals
- `memory.candidates` — pre-retrieved memory artifacts
- `enrichment.candidates` — pre-packaged backstage enrichment
- `guardrails.overlays` — expression guardrail overlays
- `continuation` — prior turn continuation payload

### `TurnContextValidationError`

Thrown when required input constraints are violated.

```ts
try {
  await assembler.assemble(input);
} catch (err) {
  if (err instanceof TurnContextValidationError) {
    console.error(err.field, err.reason);
  }
}
```

### `toExecutionRequest(assembly, userMessage, overrides?)`

Projects a `TurnContextAssembly` and incoming message into the canonical
`@agent-assistant/harness` `ExecutionRequest` used by execution adapters.
