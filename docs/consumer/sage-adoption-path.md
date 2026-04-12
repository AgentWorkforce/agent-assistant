# Sage Adoption Path

**Date:** 2026-04-12
**Contract:** `docs/architecture/v1-consumer-adoption-contract.md`
**Assembly reference:** `packages/examples/src/04-proactive-assistant.ts`
**Adoption order:** 2nd (after NightCTO validates the full composition path)

---

## Package Manifest (adopt now)

Three of four ready-now packages apply to Sage at v1. Policy is deferred until proactive follow-ups need explicit gating.

| Package | Version/Status | Why |
|---|---|---|
| `@relay-assistant/core` | SPEC_RECONCILED, 31 tests | Runtime, lifecycle, dispatch — universal foundation |
| `@relay-assistant/traits` | IMPLEMENTATION_READY, 32 tests | Sage identity (conversational, knowledge-focused, high proactivity) |
| `@relay-assistant/proactive` | implemented, 45 tests | Sage's core value — follow-up, re-engagement, stale-thread handling |

Policy is deferred — see Deferred Packages below.

Do not adopt any of the following at v1:

| Package | Block reason |
|---|---|
| `@relay-assistant/policy` | Not immediately required; defer until proactive actions need gating (v1.2) |
| `@relay-assistant/memory` | `@agent-relay/memory` dep missing — evaluate existing Relay memory before any greenfield |
| `@relay-assistant/coordination` | Tests blocked; depends on `@relay-assistant/connectivity` |
| `@relay-assistant/connectivity` | `nanoid` dep missing — tests blocked |
| `@relay-assistant/routing` | 12/40+ tests — DoD gap |

---

## Assembly Reference

**Primary:** `packages/examples/src/04-proactive-assistant.ts`

This example covers Sage's priority path: proactive engine with follow-up rules and watch rules, traits-driven formatting, and scheduler binding.

**Stepping path:**
1. Start with `01-minimal-assistant.ts` — wire the runtime with Relay foundation adapters
2. Add `02-traits-assistant.ts` — set Sage trait values, confirm traits frozen in definition
3. Upgrade to `04-proactive-assistant.ts` — replace example follow-up conditions with Sage-specific workspace heuristics

**Future upgrade target:** `05-full-assembly.ts` — when Sage needs policy gating on proactive follow-ups (v1.2). The `followUpToAction` bridge pattern in that example is the integration point.

---

## Product-Local Inventory

These concerns stay in the Sage product repo. Do not move them into the SDK.

| Concern | Why it stays local |
|---|---|
| Workspace knowledge workflows and context shaping | Sage product domain — does not generalize |
| Product-specific follow-up heuristics | Delivered as `condition` functions on proactive rules; the conditions themselves are Sage logic |
| Slack-specific behavior | May move to SDK later if MSD/NightCTO also need it; not general enough at v1 |
| Memory retrieval and workspace context assembly | Until `@relay-assistant/memory` ships in v1.1; even then, workspace-scope memory is Sage-owned |
| Knowledge digest generation | Sage-specific output format |
| Workforce persona definitions | Model, harness, system prompt, tier — stay in Workforce, never in the SDK |
| Product prompts and instruction sets | Sage-specific content |

---

## Adapter Replacement Table

For each in-memory stub in `04-proactive-assistant.ts`, the concrete adapter Sage provides:

| Stub in example | What Sage replaces it with | Status |
|---|---|---|
| `inbound: { onMessage(h) { ... }, offMessage() {} }` | Relay foundation inbound adapter (Slack transport normalization) | TODO — wire Relay adapter |
| `outbound: { async send(event) { ... } }` | Relay foundation outbound adapter (Slack delivery) | TODO — wire Relay adapter |
| `InMemorySchedulerBinding` | Relay cron substrate scheduler binding | TODO — wire Relay cron |
| Trait values (example voice/domain) | `{ voice: 'conversational', formality: 'professional', proactivity: 'high', riskPosture: 'moderate', domain: 'knowledge-and-workspace', vocabulary: ['digest', 'workspace', 'context'] }` | Ready to define |
| `idleFollowUpRule.condition` | Sage workspace-activity condition (e.g., new docs added to workspace, thread inactive after meeting concluded) | Ready to define |
| `monitoringWatchRule.condition` | Sage knowledge-staleness watch condition (e.g., digest not generated in N hours, workspace has unread context) | Ready to define |

---

## Proof Checklist

Each item must be classified as **Demonstrated**, **Inspectable**, or **Planned**.

### A. Assembly proof

- [ ] `createAssistant()` called with Sage `AssistantDefinition` containing at least one capability handler — **Inspectable**
- [ ] `runtime.start()` completes without error — **Inspectable**
- [ ] At least one inbound Slack message dispatches to the correct capability handler — **Inspectable**
- [ ] `runtime.stop()` completes without error — **Inspectable**
- [ ] In-memory adapter stubs replaced with concrete Relay adapter references (named above) — **Planned** (depends on Relay wiring)

### B. Package-specific proof

**Traits:**
- [ ] `createTraitsProvider()` called with Sage-specific trait values — **Inspectable**
- [ ] `runtime.definition.traits` frozen and accessible in capability handlers — **Inspectable**
- [ ] At least one handler reads `preferMarkdown` trait (or equivalent) and influences output format — **Inspectable**

**Proactive:**
- [ ] `createProactiveEngine()` called with scheduler binding — **Inspectable** (InMemorySchedulerBinding acceptable for initial wiring)
- [ ] At least one Sage-specific follow-up rule registered with a workspace-activity `condition` function — **Inspectable**
- [ ] `proactiveEngine.evaluateFollowUp()` called and decisions logged/inspected — **Inspectable**
- [ ] Engine retrievable from runtime via `runtime.get('proactive')` — **Inspectable**

**Policy (Planned — v1.2):**
- [ ] `createActionPolicy()` called with Sage audit sink — **Planned**
- [ ] `followUpToAction()` bridge defined in Sage product code — **Planned**
- [ ] At least one proactive `fire` decision converted to `Action` and evaluated by policy — **Planned**

### C. Boundary proof

- [ ] No Sage workspace logic (follow-up conditions, context shaping, digest generation) inside SDK source — **Planned** (verify at wiring time)
- [ ] No SDK package imports another SDK package at runtime — **Demonstrated** (enforced by SDK architecture)
- [ ] Workspace persona definitions, Slack-specific behavior, and product prompts remain in Sage repo — **Planned** (verify at wiring time)

---

## Deferred Packages

| Package | What unblocks it | When |
|---|---|---|
| `@relay-assistant/policy` | Proactive follow-ups require explicit gating; Sage product team prioritizes it | v1.2 — upgrade to `05-full-assembly.ts` pattern at that point |
| `@relay-assistant/memory` | Evaluate `@agent-relay/memory` first; only proceed if it does not satisfy workspace-scope continuity needs | v1.1 — do not build greenfield |
| `@relay-assistant/coordination` | `nanoid` dep resolved, connectivity tests pass | v1.2 (lower priority for Sage) |

**Memory note:** Before any `@relay-assistant/memory` work, Sage must evaluate whether `@agent-relay/memory` already satisfies workspace-scope continuity. Prefer wrapping/adapting over greenfield implementation.

---

## Immediate Blockers

1. **Relay adapter wiring** — Sage's Slack transport adapter must be identified and plumbed for inbound/outbound. `InMemorySchedulerBinding` is acceptable for initial proactive wiring.
2. **Follow-up condition definition** — the specific workspace-activity conditions that trigger Sage follow-ups must be authored in product code before the proactive engine has real behavior. These are the most product-specific items and cannot come from the SDK.
3. **Memory strategy decision** — Sage must decide whether `@agent-relay/memory` satisfies workspace-scope needs before v1.1 begins. Deferring this decision too long delays the memory adoption path.
