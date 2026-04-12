# v1 Proactive Package — Bounded Scope

**Status:** SCOPE_DEFINED
**Date:** 2026-04-12
**Package:** `@relay-assistant/proactive`
**Version:** v0.1.0
**Inputs:** package-boundary-map.md, v1-workflow-backlog.md, extraction-roadmap.md (Phase 3), v1-memory-spec.md, v1-connectivity-spec.md, proactive package placeholder README

---

## 1. What Proactive Behavior Means in RelayAssistant

Proactive behavior is any assistant action that originates without a direct user message in the current turn. The user is not actively messaging; the assistant decides to act based on rules, elapsed time, or observed state changes.

This SDK package owns the **decision layer** for proactive behavior. It does not own the scheduling infrastructure, the transport layer, or product-specific trigger logic.

### Proactive behavior that belongs in this package

- **Follow-up evaluation:** Given a session that has gone quiet, should the assistant reach out? The engine evaluates registered follow-up rules against session state and optional evidence, then produces a decision (fire, suppress, or defer).
- **Watch rule registration and evaluation:** Long-running rules that monitor for conditions across sessions or scopes. A watch rule is registered, periodically evaluated, and may trigger an assistant action or be paused/cancelled.
- **Reminder policies:** Configurable policies that define when and how reminders fire, including suppression conditions (user already active, reminder already sent within window, maximum reminder count reached).
- **Scheduler binding abstraction:** A thin interface that lets the engine request wake-ups from external scheduling infrastructure without owning that infrastructure. The engine says "wake me at time T with context C"; the scheduler is responsible for actually doing it.
- **Evidence contracts:** A pluggable interface (`FollowUpEvidenceSource`) that the engine can optionally query to gather decision context — recent memory entries, session metadata, or routing state — without hard-depending on any specific package.
- **In-memory adapters:** Local development and test adapters for rule storage and scheduler bindings, so the package is fully testable without external services.

### Proactive behavior that does NOT belong in this package

| Concern | Owner | Reason |
|---|---|---|
| Domain-specific watcher rules (e.g., "alert when PR has no reviewer after 2h") | Product repos | Only makes sense for one product's domain |
| Product-specific follow-up thresholds and timing | Product repos | Business logic, not reusable infrastructure |
| Scheduling infrastructure (cron, timers, dispatch) | Relay foundation (relaycron) | Transport-level substrate |
| Memory persistence and retrieval | `@relay-assistant/memory` | Separate concern; proactive reads via interface |
| Session lifecycle management | `@relay-assistant/sessions` | Proactive reads session state, does not own it |
| Outbound message delivery | `@relay-assistant/surfaces` + Relay foundation | Proactive emits events through the normal runtime path |
| Cross-agent coordination of proactive actions | `@relay-assistant/coordination` | Deferred; v1 proactive is single-agent |
| Action risk classification or approval gates | `@relay-assistant/policy` (v2) | Proactive actions are not policy-gated in v1 |

---

## 2. Relationship to Relaycron

Relaycron is Relay foundation's scheduling substrate. It owns timers, cron registration, and wake-up dispatch. The proactive package does not replace, wrap, or abstract away relaycron — it sits above it as a consumer.

### Ownership split

| Relaycron (Relay foundation) | Proactive (this package) |
|---|---|
| Accepts wake-up requests with a time and opaque context | Decides *when* and *why* to request a wake-up |
| Stores scheduled entries and fires at the specified time | Evaluates rules and evidence to produce decisions |
| Dispatches a synthetic inbound message to the assistant at wake-up time | Receives the synthetic message via normal `runtime.dispatch()` and acts on it |
| Knows nothing about sessions, rules, evidence, or reminder policy | Knows everything about rules and policy; knows nothing about timer implementation |

### Interaction contract

The proactive engine communicates with relaycron through a `SchedulerBinding` interface:

```ts
interface SchedulerBinding {
  requestWakeUp(at: Date, context: WakeUpContext): Promise<string>; // returns bindingId
  cancelWakeUp(bindingId: string): Promise<void>;
}

interface WakeUpContext {
  sessionId: string;
  ruleId?: string;
  scheduledAt: string; // ISO-8601 — the engine needs this for suppression checks
  metadata?: Record<string, unknown>;
}
```

**At wake-up time,** relaycron dispatches a synthetic `InboundMessage` to the assistant runtime with `capability: 'proactive'` (or a product-chosen capability name). The proactive engine is invoked as a normal capability handler — it does not receive a callback.

**Cancellation** is supported via `bindingId`. When a watch rule is paused or cancelled, or a reminder is superseded, the engine calls `cancelWakeUp(bindingId)`.

### What v1 ships for scheduler binding

- A `SchedulerBinding` interface definition (no implementation of actual relaycron integration)
- An `InMemorySchedulerBinding` for tests that records requested wake-ups and allows manual trigger
- Products wire the real relaycron binding themselves via the interface

This means **v1 proactive is fully testable without relaycron** and products adopt the real binding at their own pace.

---

## 3. v1 Scope vs. Deferred

### In scope for v1

| Capability | Detail |
|---|---|
| `createProactiveEngine(config)` factory | Returns a `ProactiveEngine` with all v1 methods |
| Follow-up rule registration | `engine.registerFollowUpRule(rule)` — products supply domain rules |
| Follow-up evaluation | `engine.evaluateFollowUp(context)` — evaluates registered rules against session state and optional evidence; returns `FollowUpDecision[]` |
| Follow-up suppression | Compares `session.lastActivityAt` to `context.scheduledAt`; suppresses if user became active since the wake-up was scheduled |
| Watch rule registration | `engine.registerWatchRule(rule)` with `id`, `condition`, `action`, `interval` |
| Watch rule lifecycle | `pause(ruleId)`, `cancel(ruleId)`, `list()` — watch rules are long-lived and survive across evaluations |
| Watch rule evaluation | `engine.evaluateWatchRules(context)` — evaluates all active rules, returns triggered actions |
| Watch rule re-scheduling | After every evaluation (not just on trigger), re-schedule the next check. Rules that don't trigger still get re-evaluated on their interval. |
| Reminder policy | `ReminderPolicy` type with `maxReminders`, `cooldownMs`, `suppressWhenActive` |
| Reminder state tracking | In-memory tracking of reminder counts and last-sent timestamps per session/rule |
| Scheduler binding interface | `SchedulerBinding` with `requestWakeUp` / `cancelWakeUp` |
| `InMemorySchedulerBinding` | Test adapter that records bindings and allows manual dispatch |
| `FollowUpEvidenceSource` | Optional interface for evidence access (memory, session, custom) |
| Error types | `ProactiveError`, `RuleNotFoundError`, `SchedulerBindingError` |
| 40+ tests | Per DoD standard established by memory, routing, and other v1 packages |

### Deferred (v1.1 or later)

| Capability | Target | Reason for deferral |
|---|---|---|
| Real relaycron binding implementation | v1.1 | Requires relaycron API to be stable; v1 ships the interface only |
| Persistent rule storage adapter | v1.1 | v1 is in-memory only; persistence requires adapter design |
| Session archival trigger | v1.1 | Depends on memory promotion workflow being stable |
| Automatic memory-to-evidence pipeline | v1.1 | Requires `@relay-assistant/memory` v1 to be integrated |
| Coordination-driven proactive actions | v1.2 | Multi-agent proactive behavior requires coordination wiring |
| Proactive action budgets / rate limiting | v2 | Belongs in `@relay-assistant/policy` |
| Traits-aware proactive voice | v1.2 | Depends on `@relay-assistant/traits` |
| Distributed watch rule evaluation | v2+ | Requires cluster-aware scheduling; single-process only in v1 |
| Event-stream watchers (real-time webhook triggers) | v1.2 | v1 is poll-based via scheduler; event-driven watchers are additive |
| Cross-session rule scoping | v1.1 | v1 rules are scoped to a single session or explicit scope |

---

## 4. Interaction with Other Packages

### Memory (`@relay-assistant/memory`)

**Relationship:** Optional evidence source. No direct import.

The proactive engine can query memory to inform follow-up decisions (e.g., "has the user mentioned this topic before?"), but it does so through the `FollowUpEvidenceSource` interface, not by importing `@relay-assistant/memory` directly.

```ts
interface FollowUpEvidenceSource {
  getRecentEntries(sessionId: string, options?: { limit?: number; tags?: string[] }): Promise<EvidenceEntry[]>;
}
```

Products wire a memory-backed evidence source if they want memory-informed proactive behavior:

```ts
const evidenceSource: FollowUpEvidenceSource = {
  getRecentEntries: (sessionId, opts) =>
    memoryStore.retrieve({ scope: { kind: 'session', sessionId }, ...opts }),
};

const engine = createProactiveEngine({
  evidenceSource, // optional
  schedulerBinding: inMemoryBinding,
});
```

**Why not a direct dependency?** Proactive must work without memory. A simple assistant may have follow-up rules based purely on session inactivity, with no memory at all.

**Memory promotion connection:** When a session ends and the proactive engine detects it (via session state), the *product* — not the proactive engine — decides whether to promote session-scoped memories to user scope. The proactive engine may *trigger* the event, but the promotion call goes through `memoryStore.promote()` in product code.

### Sessions (`@relay-assistant/sessions`)

**Relationship:** Read-only consumer of session state.

The proactive engine reads `session.lastActivityAt` and `session.state` to make suppression and follow-up decisions. It does not modify sessions.

Products pass session state into the engine through the evaluation context:

```ts
const session = await sessionStore.get(sessionId);
const decisions = await engine.evaluateFollowUp({
  sessionId,
  scheduledAt: wakeUpContext.scheduledAt,
  lastActivityAt: session.lastActivityAt,
});
```

The engine does not import `@relay-assistant/sessions`. It receives session data as plain values in the evaluation context.

### Coordination (`@relay-assistant/coordination`)

**Relationship:** None in v1.

v1 proactive behavior is single-agent. The engine does not delegate to specialists, emit coordination signals, or participate in delegation plans. If a proactive action requires specialist work, the product's capability handler handles the coordination call itself.

**v1.2 integration path:** When coordination integration ships, the proactive engine will be able to emit a `proactive.trigger` signal via the connectivity layer, allowing coordinators to observe proactive decisions and optionally delegate work.

### Routing (`@relay-assistant/routing`)

**Relationship:** Optional hint, no dependency.

Follow-up rules may include a `routingHint` field (`'cheap' | 'fast' | 'deep'`) that suggests what response mode the proactive action should use. This is a plain string — the proactive package does not import `@relay-assistant/routing`.

Products read the routing hint from the follow-up decision and pass it to their routing logic:

```ts
const decisions = await engine.evaluateFollowUp(context);
for (const decision of decisions) {
  if (decision.action === 'fire') {
    await handleProactiveAction(decision, decision.routingHint ?? 'cheap');
  }
}
```

**Default:** When no routing hint is specified, proactive actions default to `'cheap'` — proactive follow-ups should be low-cost unless the rule explicitly requests otherwise.

### Surfaces (`@relay-assistant/surfaces`)

**Relationship:** Indirect, through the runtime.

Proactive actions produce `OutboundEvent` objects that flow through the normal `runtime.emit()` path. The proactive engine does not interact with surfaces directly.

When a follow-up fires, the capability handler emits an outbound event:

```ts
// In the proactive capability handler
const decisions = await engine.evaluateFollowUp(context);
for (const decision of decisions) {
  if (decision.action === 'fire') {
    await context.runtime.emit({
      sessionId: decision.sessionId,
      text: decision.message,
      // No surfaceId → fanout to all attached surfaces
    });
  }
}
```

This means proactive messages respect the same fanout/targeted-send rules as user-triggered messages. No special surface handling is needed.

### Connectivity (`@relay-assistant/connectivity`)

**Relationship:** None in v1.

The proactive engine does not emit connectivity signals in v1. When a proactive action fires, it goes through the normal capability handler path, which may emit signals if the product's handler is wired to do so.

**v1.2 integration path:** The engine may emit `proactive.trigger` signals for observability, allowing other subsystems to react to proactive decisions.

---

## 5. Implementation Feasibility

### Package structure

```
packages/proactive/
  package.json          — zero runtime dependencies (nanoid for IDs)
  tsconfig.json
  src/
    types.ts            — all exported types, interfaces, error classes
    proactive.ts        — createProactiveEngine factory, rule evaluation, reminder tracking
    index.ts            — public re-exports
    proactive.test.ts   — 40+ tests
  README.md
```

### Estimated size

- `types.ts`: ~150 lines (rule types, decision types, evidence interface, config, errors)
- `proactive.ts`: ~400 lines (engine factory, follow-up evaluation, watch rule management, reminder state, suppression logic)
- `index.ts`: ~25 lines
- `proactive.test.ts`: ~500 lines (40+ tests)
- Total: ~1075 lines

### Dependencies

| Dependency | Type | Reason |
|---|---|---|
| `nanoid` | Runtime | Rule and binding ID generation |
| `vitest` | Dev | Testing |
| `typescript` | Dev | Build |

**No runtime dependency on any other `@relay-assistant/*` package.** All cross-package integration is through interfaces that products wire.

### Test categories (minimum 40)

| Category | Count | Coverage |
|---|---|---|
| Type structural tests | 4 | All required types and interfaces exist |
| Follow-up rule registration | 5 | Register, list, remove, duplicate rejection, validation |
| Follow-up evaluation | 8 | Basic fire, suppression (user active), suppression (cooldown), multiple rules, evidence integration, empty rules, routing hint passthrough, decision ordering |
| Watch rule lifecycle | 6 | Register, pause, cancel, list, re-register after cancel, evaluation with paused rules |
| Watch rule evaluation | 5 | Trigger on condition, no-trigger passthrough, re-scheduling after evaluation, multiple rules, evaluation context |
| Reminder policy | 6 | Max reminders, cooldown, suppress-when-active, reminder count tracking, reset on user activity, policy defaults |
| Scheduler binding | 4 | Request wake-up, cancel wake-up, InMemorySchedulerBinding manual trigger, binding ID uniqueness |
| Error handling | 3 | RuleNotFoundError, invalid rule validation, scheduler binding failure wrapping |
| **Total** | **41** | |

### PR scope

Single PR. The package is self-contained with no cross-package code changes needed. Products adopt by importing the package and wiring the scheduler binding and optional evidence source.

---

## 6. Key Design Decisions

### Follow-up evaluation receives full context, not just sessionId

The `evaluateFollowUp` method receives an evaluation context object, not a bare `sessionId`. This allows suppression logic to compare `scheduledAt` against `lastActivityAt` without the engine needing to query session state itself:

```ts
interface FollowUpEvaluationContext {
  sessionId: string;
  scheduledAt: string;        // ISO-8601 — when the wake-up was originally scheduled
  lastActivityAt: string;     // ISO-8601 — session's last activity timestamp
  evidence?: EvidenceEntry[]; // optional pre-fetched evidence
}
```

**Rationale:** The engine must know both *when it was supposed to wake up* and *when the user was last active* to make correct suppression decisions. Passing only `sessionId` would require the engine to import and query the session store directly, violating the dependency boundary.

### Watch rules re-schedule after every evaluation

After `evaluateWatchRules()` is called, all active (non-paused, non-cancelled) rules request a new wake-up for their next interval — regardless of whether they triggered. This ensures rules that don't trigger continue to be monitored.

**Rationale:** A watch rule that checks "has the PR been reviewed?" should keep checking even when the answer is "not yet." Only cancelled or paused rules stop scheduling.

### Proactive capability handler is product-owned

The proactive package does not register a capability handler on the runtime. Products write their own `proactive` capability handler and call engine methods inside it. This keeps the engine a pure decision library with no runtime coupling:

```ts
const definition: AssistantDefinition = {
  id: 'my-assistant',
  name: 'My Assistant',
  capabilities: {
    chat: chatHandler,
    proactive: async (message, context) => {
      // Product-owned: call engine, emit responses, handle errors
      const decisions = await engine.evaluateFollowUp(parseWakeUpContext(message));
      // ...
    },
  },
};
```

### In-memory only for v1

All rule storage and reminder state is in-memory. There is no adapter interface for persistent rule storage in v1. This keeps the implementation small and avoids premature abstraction before usage patterns are established.

**v1.1 path:** If products need persistent rules, a `ProactiveStoreAdapter` interface will be added following the same pattern as `MemoryStoreAdapter` and `SessionStoreAdapter`.

---

## 7. Extraction Signals

The proactive package generalizes patterns from three products:

| Product | Pattern | What gets extracted |
|---|---|---|
| Sage | Stale-thread follow-ups, knowledge refresh nudges | Follow-up evaluation, suppression when active, cooldown policy |
| MSD | PR review reminders, unreviewed-PR watchers | Watch rule registration, reminder max-count, re-scheduling |
| NightCTO | Proactive monitoring digests, service health watchers | Watch rule evaluation, evidence-based decisions, routing hints |

Products keep their domain-specific rule definitions. The engine provides the evaluation, scheduling, and suppression infrastructure.

---

V1_PROACTIVE_SCOPE_READY
