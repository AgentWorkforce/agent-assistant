# v1 Telemetry Spec — `@agent-assistant/telemetry`

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-20
**Package:** `@agent-assistant/telemetry`
**Version target:** v0.1.0 (pre-1.0, provisional)
**Adoption posture:** direct-import / wave-2 until implementation and consumer proof exist

---

## 1. Responsibilities

`@agent-assistant/telemetry` owns the usage, cost, and response telemetry primitives emitted by a harness turn. It attaches to the harness via the `onTurnFinished` lifecycle hook and converts completed turns into structured `TelemetryEvent` records that downstream consumers (Sage, internal analytics, billing, offline replay) can persist, query, and aggregate.

**Owns:**
- pricing table type + in-memory snapshot (`FROZEN_PRICING_TABLE`) and `refreshPricingTable()` fetcher against the OpenRouter `/models` endpoint
- cost math (`computeCost(usage, modelId, table)`) returning `{ usd, missingPricing }`
- `TelemetryEvent` shape (event id, kind, timestamp, assistant/turn/thread/user ids, input, output, transcript, usage, cost, metadata)
- `TelemetrySink` interface and reference sinks: `ConsoleTelemetrySink`, `InMemoryTelemetrySink`, `CompositeTelemetrySink`, `R2TelemetrySink`
- `createTelemetryHook(options)` harness bridge that produces a function assignable to `HarnessConfig.hooks.onTurnFinished`

**Does NOT own:**
- the harness runtime or the `onTurnFinished` hook itself (→ `@agent-assistant/harness`)
- session storage or replay (→ `@agent-assistant/sessions`)
- billing decisions, quota enforcement, or retry/backpressure logic (→ product code)
- long-lived pricing table persistence — consumers cache the snapshot as they see fit
- PII redaction — transcripts are emitted verbatim; consumers scrub before durable storage

---

## 2. Non-goals

- The package does not push events over the network; sinks fan out but the package does not choose a transport.
- The package does not implement rate limiting or deduping of telemetry events.
- The package does not maintain a real-time pricing feed; `refreshPricingTable()` is a pull on demand.
- The package does not mutate the harness result or the turn's user-visible behavior.

---

## 3. Integration contract

```ts
import { createHarness } from '@agent-assistant/harness';
import {
  createTelemetryHook,
  CompositeTelemetrySink,
  ConsoleTelemetrySink,
  R2TelemetrySink,
  FROZEN_PRICING_TABLE,
} from '@agent-assistant/telemetry';

const sink = new CompositeTelemetrySink([
  new ConsoleTelemetrySink({ level: 'summary' }),
  new R2TelemetrySink({ bucket, prefix: 'turns' }),
]);

const harness = createHarness({
  model,
  hooks: {
    onTurnFinished: createTelemetryHook({ sink, pricingTable: FROZEN_PRICING_TABLE }),
  },
});
```

The bridge fires once per terminal turn, inside the harness's existing `finally` block, after `emitFinishedSafely`. Errors thrown inside the sink are swallowed and logged via `console.warn` so telemetry failures never crash a turn.

---

## 4. `TelemetryEvent` shape

```ts
interface TelemetryEvent {
  eventId: string;               // uuid; overridable via generateEventId
  eventKind: 'turn.finished';
  timestamp: string;             // ISO-8601
  assistantId: string;
  turnId: string;
  threadId?: string;
  userId?: string;
  input: { message: string; systemPrompt?: string };
  output: {
    kind: 'final_answer'
        | 'failed'
        | 'refused'
        | 'deferred'
        | 'clarification'
        | 'approval';
    text?: string;
    stopReason?: string;
  };
  transcript: HarnessTranscriptItem[];
  usage: HarnessAggregateUsage;
  cost: {
    usd: number;
    missingPricing: boolean;           // true if any per-model entry had no pricing row
    perModel: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      usd: number;
      missingPricing: boolean;
    }>;
  };
  metadata?: Record<string, unknown>;  // includes outcome, plus user-provided metadataFor()
}
```

### 4.1 `output.kind` is derived from `HarnessOutcome`, not inferred

| `HarnessResult.outcome`    | `output.kind`      | Special case                                |
| -------------------------- | ------------------ | ------------------------------------------- |
| `completed`                | `final_answer`     | —                                           |
| `needs_clarification`      | `clarification`    | —                                           |
| `awaiting_approval`        | `approval`         | —                                           |
| `deferred`                 | `deferred`         | —                                           |
| `failed`                   | `failed`           | `stopReason === 'model_refused'` → `refused` |

Deferred/clarification/approval outcomes must not collapse to `final_answer` — downstream queries that count final answers would otherwise over-report.

### 4.2 `cost.missingPricing`

`computeCost` returns `missingPricing: true` when `modelId` is absent from the pricing table. The bridge preserves that flag both per-model and at the aggregate level. A turn with `usd: 0 + missingPricing: true` must be distinguishable from a truly zero-cost turn in downstream consumers (billing, anomaly detection).

---

## 5. Required harness context

The bridge reads from `HarnessExecutionState`:

- `state.input.message.text` and `state.input.instructions.systemPrompt` feed `event.input`.
- `state.transcript` feeds `event.transcript`.
- `state.modelCalls` (iteration, modelId, usage, outputType) feeds `event.cost.perModel`; the bridge falls back to scanning assistant-step metadata if `modelCalls` is unset.
- `state.userId` and `state.threadId` are surfaced verbatim.

The harness populates these fields when invoking `onTurnFinished`. Without them, cost collapses to zero and input/transcript come through empty, so telemetry is effectively corrupt. Model adapters that want per-model cost breakdown must set `metadata.modelId` (or `metadata.model`) on their outputs — the OpenRouter adapter ships this by default.

---

## 6. Sinks

- `ConsoleTelemetrySink({ level: 'full' | 'summary' })` — JSON.stringify to stdout with `[telemetry]` prefix. `summary` level elides large transcripts.
- `InMemoryTelemetrySink` — test helper, buffers events in memory.
- `CompositeTelemetrySink(sinks[])` — fans out with `Promise.allSettled`; logs rejected children via `console.warn` and keeps emitting to the rest.
- `R2TelemetrySink({ bucket, prefix })` — writes JSON objects at `${prefix}/YYYY/MM/DD/<turnId>.json`. `turnId` is sanitized to replace `/` with `_` so path traversal is structurally impossible. Structural `MinimalR2Bucket` type means no hard dependency on `@cloudflare/workers-types`.

Consumers compose their own sinks by implementing `TelemetrySink` (`emit(event): Promise<void> | void`).

---

## 7. Pricing table

`PricingTable` is `Record<string, ModelPricing>` keyed by OpenRouter-style model id (`'anthropic/claude-sonnet-4.6'`, `'openai/gpt-4.1'`, etc.).

- `FROZEN_PRICING_TABLE` — manual snapshot covering Sonnet 4.6, Haiku 4.5, and the GPT-4.1 family, including cached-read price where applicable. Suitable for offline tests and environments without network access.
- `refreshPricingTable({ fetchImpl?, endpoint? })` — pulls from `/v1/models`, converts string prices to numbers, and stamps `fetchedAt`. Consumers decide when to refresh and how to persist.

---

## 8. Testing

The package ships vitest coverage for:

- cost math and `missingPricing` behavior
- pricing refresh (parses OpenRouter payloads, handles number/string prices)
- composite sink fan-out with `Promise.allSettled` failure isolation
- R2 sink key partitioning (`turns/YYYY/MM/DD/<turnId>.json`) and `turnId` sanitization
- bridge: outcome→kind mapping for every outcome, `refused` special-case, `missingPricing` preservation, sink error swallowing, custom `generateEventId`

Consumer packages (Sage) add end-to-end assertions that a completed turn emits exactly one event with expected usage and cost.

---

## 9. Open questions / future work

- Sampling / redaction hooks on the bridge (currently a consumer concern)
- Cached-read cost accounting (pricing table carries the field; cost math does not yet consume it)
- Latency telemetry split per model call vs. aggregated
- Structured `TelemetryEvent` schema versioning once a non-compatible change is needed
