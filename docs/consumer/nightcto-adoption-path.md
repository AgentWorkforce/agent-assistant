# NightCTO Adoption Path

**Date:** 2026-04-12
**Contract:** `docs/architecture/v1-consumer-adoption-contract.md`
**Assembly reference:** `packages/examples/src/05-full-assembly.ts`
**Adoption order:** 1st (recommended first adopter — see rollout plan)

---

## Package Manifest (adopt now)

All four ready-now packages apply to NightCTO. Adopt in this order:

| Package | Version/Status | Why |
|---|---|---|
| `@agent-assistant/core` | SPEC_RECONCILED, 31 tests | Runtime, lifecycle, dispatch — universal foundation |
| `@agent-assistant/traits` | IMPLEMENTATION_READY, 32 tests | Founder/CTO identity established early; read-only, no downstream deps |
| `@agent-assistant/policy` | implemented, 64 tests | Client-tier policy, cross-client data gating, escalation to human CTO |
| `@agent-assistant/proactive` | implemented, 45 tests | Monitoring re-engagement, client thread check-in, stale pipeline follow-up |

Do not adopt any of the following at v1:

| Package | Block reason |
|---|---|
| `@agent-assistant/memory` | `@agent-relay/memory` dep missing — placeholder only |
| `@agent-assistant/coordination` | Tests blocked; depends on `@agent-assistant/connectivity` |
| `@agent-assistant/connectivity` | `nanoid` dep missing — tests blocked |
| `@agent-assistant/routing` | 12/40+ tests — DoD gap |

---

## Assembly Reference

**Primary:** `packages/examples/src/05-full-assembly.ts`

This is the canonical four-package composition. NightCTO goes directly to this example — do not step through 01 → 02 → 03 → 04 sequentially. Start at 05.

**Supporting references:**
- `01-minimal-assistant.ts` — adapter wiring, lifecycle, `onError` hook
- `02-traits-assistant.ts` — trait value choices and handler formatting
- `03-policy-gated-assistant.ts` — policy rule shape and all four decision branches
- `04-proactive-assistant.ts` — follow-up rule conditions and scheduler binding

**Known gap in 05 (from review verdict):** `05-full-assembly.ts` does not yet register a watch rule, evaluate watch triggers, or demonstrate `watchTriggerToAction()` through policy. NightCTO's monitoring-heavy path requires this. Track as Planned in the proof checklist below until resolved upstream.

---

## Product-Local Inventory

These concerns stay in the NightCTO product repo. Do not move them into the SDK.

| Concern | Why it stays local |
|---|---|
| Founder/CTO communication style and register | Highly personalized; not generalizable across other products |
| Specialist lineup and dispatch logic | NightCTO's internal agent roster is product-specific |
| Client-tier policy rules and service agreements | Business rules vary per client engagement |
| Per-client memory and relationship continuity | Until `@agent-assistant/memory` ships (v1.1); even then, client-tier scoping is NightCTO-owned |
| Escalation routing and human-CTO notification | Product UX concern — not an SDK contract |
| Monitoring window definitions | Domain-specific scheduling logic |
| Workforce persona definitions | Model, harness, system prompt, tier — stay in Workforce, never in the SDK |
| Product prompts and instruction sets | Product intellectual property |

---

## Adapter Replacement Table

For each in-memory stub in `05-full-assembly.ts`, the concrete adapter NightCTO provides:

| Stub in example | What NightCTO replaces it with | Status |
|---|---|---|
| `inbound: { onMessage(h) { ... }, offMessage() {} }` | Relay foundation inbound adapter (transport normalization layer) | TODO — wire Relay adapter |
| `outbound: { async send(event) { ... } }` | Relay foundation outbound adapter (delivery layer) | TODO — wire Relay adapter |
| `InMemorySchedulerBinding` | Relay cron substrate scheduler binding | TODO — wire Relay cron |
| `InMemoryAuditSink` | NightCTO audit infrastructure (persistent audit log) | TODO — wire production audit sink |
| Trait values (example voice/domain) | `{ voice: 'formal', formality: 'professional', proactivity: 'high', riskPosture: 'assertive', domain: 'executive-advisory', vocabulary: ['runway', 'burn', 'pipeline', 'escalate', 'client'] }` | Ready to define |
| Example policy rule (`block-high-risk`) | `block-cross-client-data` rule + `escalate-critical` rule (see v1-product-adoption-matrix) | Ready to define |
| Example proactive rule (`idleFollowUpRule`) | `client-status-check-in` rule (12h idle threshold during monitoring window) | Ready to define |

---

## Proof Checklist

Each item must be classified as **Demonstrated**, **Inspectable**, or **Planned**.

### A. Assembly proof

- [ ] `createAssistant()` called with NightCTO `AssistantDefinition` containing `reply` capability — **Inspectable** (visible in product code once wired)
- [ ] `runtime.start()` completes without error — **Inspectable**
- [ ] At least one inbound message dispatches to the `reply` capability handler — **Inspectable**
- [ ] `runtime.stop()` completes without error — **Inspectable**
- [ ] In-memory adapter stubs replaced with concrete Relay adapter references (named above) — **Planned** (depends on Relay wiring)

### B. Package-specific proof

**Traits:**
- [ ] `createTraitsProvider()` called with NightCTO-specific trait values — **Inspectable**
- [ ] `runtime.definition.traits` frozen and accessible in `reply` handler — **Inspectable**
- [ ] `reply` handler reads `preferMarkdown` trait and adjusts output format — **Inspectable**

**Policy:**
- [ ] `createActionPolicy()` called with NightCTO audit sink — **Inspectable**
- [ ] `block-cross-client-data` rule registered via `policyEngine.registerRule()` — **Inspectable**
- [ ] `escalate-critical` rule registered via `policyEngine.registerRule()` — **Inspectable**
- [ ] `reply` handler constructs `Action` from inbound message and calls `policyEngine.evaluate()` — **Inspectable**
- [ ] All four decision branches (`allow`, `deny`, `require_approval`, `escalate`) have handling code — **Inspectable** (deny/require_approval/escalate may be stubbed at v1)

**Proactive:**
- [ ] `createProactiveEngine()` called with Relay cron scheduler binding — **Planned** (InMemorySchedulerBinding acceptable for first wiring)
- [ ] `client-status-check-in` follow-up rule registered with 12h idle condition — **Inspectable**
- [ ] `proactiveEngine.evaluateFollowUp()` called and decisions inspected — **Inspectable**
- [ ] Engine retrievable from runtime via `runtime.get('proactive')` — **Inspectable**

**Proactive → Policy bridge:**
- [ ] `followUpToAction()` defined in NightCTO product code — **Inspectable**
- [ ] At least one `fire` decision converted to `Action` with `proactive: true` and evaluated by `policyEngine.evaluate()` — **Inspectable**
- [ ] Policy audit trail contains entries for both inbound-originated and proactive-originated actions — **Inspectable**

**Watch-trigger path (gap from review verdict):**
- [ ] Watch rule registered with `proactiveEngine.registerWatchRule()` — **Planned** (blocked on upstream `05-full-assembly.ts` gap)
- [ ] Watch trigger evaluated and converted via `watchTriggerToAction()` — **Planned**
- [ ] Watch-originated action evaluated by policy engine — **Planned**

### C. Boundary proof

- [ ] No NightCTO-specific logic (client rules, specialist lineup, escalation) inside SDK package source — **Planned** (verify at wiring time)
- [ ] No SDK package imports another SDK package at runtime — **Demonstrated** (enforced by SDK architecture)
- [ ] Founder communication style, persona definitions, and workforce tiers remain in product/Workforce repos — **Planned** (verify at wiring time)

---

## Deferred Packages

| Package | What unblocks it | When |
|---|---|---|
| `@agent-assistant/memory` | `@agent-relay/memory` dep resolved; v1.1 milestone complete | v1.1 — defer per-client memory until then |
| `@agent-assistant/coordination` | `nanoid` dep resolved, connectivity tests pass, coordination tests pass | v1.2 |
| `@agent-assistant/connectivity` | `nanoid` installed in connectivity package | v1.2 (prerequisite for coordination) |

When `@agent-assistant/memory` ships: integrate per-client memory scoped to `clientId`. Until then, NightCTO manages per-client continuity in product code.

When `@agent-assistant/coordination` ships: specialist lineup and dispatch logic may migrate partially to the SDK coordination contract. Product-specific specialist definitions stay local regardless.

---

## Immediate Blockers

1. **Relay adapter wiring** — the concrete inbound/outbound Relay adapters for NightCTO must be identified and plumbed. The SDK examples use in-memory stubs; NightCTO must replace these before any real traffic flows.
2. **Relay cron substrate** — `InMemorySchedulerBinding` must be replaced with the Relay cron binding before proactive monitoring rules fire on a real schedule.
3. **Audit sink** — `InMemoryAuditSink` is acceptable for first wiring; replace with persistent audit infrastructure before production use.
4. **Watch-trigger gap** — `05-full-assembly.ts` does not yet cover the watch-trigger-to-policy path. NightCTO must implement this product-side until the upstream example is extended.
