# MSD (My Senior Dev) Adoption Path

**Date:** 2026-04-12
**Contract:** `docs/architecture/v1-consumer-adoption-contract.md`
**Assembly reference:** `packages/examples/src/03-policy-gated-assistant.ts`
**Adoption order:** 3rd (after NightCTO and Sage validate the composition patterns MSD needs)

---

## Package Manifest (adopt now)

Three of four ready-now packages apply to MSD at v1. Proactive is deferred until automated PR follow-up is prioritized.

| Package | Version/Status | Why |
|---|---|---|
| `@relay-assistant/core` | SPEC_RECONCILED, 31 tests | Runtime, lifecycle, dispatch — universal foundation |
| `@relay-assistant/traits` | IMPLEMENTATION_READY, 32 tests | MSD identity (technical, cautious, code-review-focused) |
| `@relay-assistant/policy` | implemented, 64 tests | MSD code review actions require gating — merge, deploy, approve, comment |

Proactive is deferred — see Deferred Packages below.

Do not adopt any of the following at v1:

| Package | Block reason |
|---|---|
| `@relay-assistant/proactive` | Not immediately required; defer until automated PR follow-up behavior is prioritized (v1.2) |
| `@relay-assistant/memory` | `@agent-relay/memory` dep missing — placeholder only |
| `@relay-assistant/coordination` | Tests blocked; depends on `@relay-assistant/connectivity` |
| `@relay-assistant/connectivity` | `nanoid` dep missing — tests blocked |
| `@relay-assistant/routing` | 12/40+ tests — DoD gap |

---

## Assembly Reference

**Primary:** `packages/examples/src/03-policy-gated-assistant.ts`

This example covers MSD's priority path: policy engine with product-specific rules, action construction in capability handlers, and the four decision branches.

**Known gap in example 03 (from review verdict):** `03-policy-gated-assistant.ts` only exercises the `allow` path in its proof scenarios. The `deny`, `require_approval`, and `escalate` branches exist in code but are not driven in the example. MSD's adoption proof must label these branches as **Inspectable** rather than **Demonstrated** until MSD's own tests drive all four outcomes.

**Stepping path:**
1. Start with `01-minimal-assistant.ts` — wire the runtime with Relay foundation adapters
2. Upgrade to `03-policy-gated-assistant.ts` — add policy engine with MSD-specific rules
3. Add `02-traits-assistant.ts` traits — set MSD trait values alongside policy

**Future upgrade target:** `05-full-assembly.ts` — when MSD needs automated proactive PR follow-up (v1.2).

---

## Product-Local Inventory

These concerns stay in the MSD product repo. Do not move them into the SDK.

| Concern | Why it stays local |
|---|---|
| Code review operations and PR workflow tools | MSD-specific domain — does not generalize across products |
| Review-specific orchestration and delegation | Until `@relay-assistant/coordination` ships; even then, only if the pattern generalizes |
| Action risk classifier taxonomy | MSD's risk categories (`merge`, `deploy`, `comment`, `approve`) are domain-specific |
| Review escalation chains | Business rules owned by MSD |
| Coordinator/notifier/reviewer role dispatch | Product-specific multi-agent pattern — keep local until coordination package unblocks |
| Workforce persona definitions | Model, harness, system prompt, tier — stay in Workforce, never in the SDK |
| Product prompts and instruction sets | MSD-specific content |

---

## Adapter Replacement Table

For each in-memory stub in `03-policy-gated-assistant.ts`, the concrete adapter MSD provides:

| Stub in example | What MSD replaces it with | Status |
|---|---|---|
| `inbound: { onMessage(h) { ... }, offMessage() {} }` | Relay foundation inbound adapter (transport normalization for MSD's surfaces) | TODO — wire Relay adapter |
| `outbound: { async send(event) { ... } }` | Relay foundation outbound adapter (delivery to MSD's surfaces) | TODO — wire Relay adapter |
| `InMemoryAuditSink` | MSD persistent audit sink (code review audit log) | TODO — wire production audit sink |
| Trait values (example voice/domain) | `{ voice: 'technical', formality: 'professional', proactivity: 'low', riskPosture: 'cautious', domain: 'code-review', vocabulary: ['diff', 'PR', 'review', 'merge', 'LGTM'] }` | Ready to define |
| Example policy rule (`block-high-risk`) | `block-destructive` rule (deny irreversible production mutations) | Ready to define |
| Example policy rule (medium-risk default) | `approve-pr-merge` rule (require approval before merging) | Ready to define |
| _(add third rule)_ | `approve-code-deploy` rule (require approval for deployments above risk threshold) | Ready to define |
| Risk classifier stub | `msdClassifier` — product-owned `RiskClassifier` with MSD action-type taxonomy | Ready to define |

### MSD risk classifier (product-owned)

```ts
// In MSD product code — not in the SDK
const msdClassifier: RiskClassifier = {
  classify(action) {
    if (action.type === 'merge_pr_to_main') return 'high';
    if (action.type === 'deploy_to_production') return 'critical';
    if (action.type === 'create_review_comment') return 'low';
    if (action.type === 'approve_pr') return 'medium';
    return 'medium';
  },
};
const policyEngine = createActionPolicy({ classifier: msdClassifier, auditSink });
```

---

## Proof Checklist

Each item must be classified as **Demonstrated**, **Inspectable**, or **Planned**.

### A. Assembly proof

- [ ] `createAssistant()` called with MSD `AssistantDefinition` containing at least one capability handler (e.g., `review`) — **Inspectable**
- [ ] `runtime.start()` completes without error — **Inspectable**
- [ ] At least one inbound code review message dispatches to the `review` capability handler — **Inspectable**
- [ ] `runtime.stop()` completes without error — **Inspectable**
- [ ] In-memory adapter stubs replaced with concrete Relay adapter references (named above) — **Planned** (depends on Relay wiring)

### B. Package-specific proof

**Traits:**
- [ ] `createTraitsProvider()` called with MSD-specific trait values — **Inspectable**
- [ ] `runtime.definition.traits` frozen and accessible in capability handlers — **Inspectable**
- [ ] At least one handler reads `preferMarkdown` or `riskPosture` trait and influences output — **Inspectable**

**Policy:**
- [ ] `createActionPolicy()` called with MSD `msdClassifier` and audit sink — **Inspectable**
- [ ] `block-destructive` rule registered via `policyEngine.registerRule()` — **Inspectable**
- [ ] `approve-pr-merge` rule registered via `policyEngine.registerRule()` — **Inspectable**
- [ ] `review` capability handler constructs `Action` from inbound message and calls `policyEngine.evaluate()` — **Inspectable**
- [ ] `allow` branch has handling code — **Inspectable** (exercisable with low-risk review comment action)
- [ ] `deny` branch has handling code — **Inspectable** (not yet driven by example — classify as Inspectable per review verdict)
- [ ] `require_approval` branch has handling code — **Inspectable** (not yet driven by example)
- [ ] `escalate` branch has handling code — **Inspectable** (not yet driven by example)

**Proactive (Planned — v1.2):**
- [ ] `createProactiveEngine()` called with scheduler binding — **Planned**
- [ ] At least one PR follow-up rule registered — **Planned**
- [ ] `followUpToAction()` bridge defined in MSD product code — **Planned**

### C. Boundary proof

- [ ] No MSD-specific logic (risk classifier, PR workflow, review escalation) inside SDK source — **Planned** (verify at wiring time)
- [ ] No SDK package imports another SDK package at runtime — **Demonstrated** (enforced by SDK architecture)
- [ ] Coordinator role dispatch, specialist lineup, and persona definitions remain in MSD/Workforce repos — **Planned** (verify at wiring time)

---

## Deferred Packages

| Package | What unblocks it | When |
|---|---|---|
| `@relay-assistant/proactive` | Automated PR follow-up behavior prioritized; add using `05-full-assembly.ts` as composition reference | v1.2 |
| `@relay-assistant/coordination` | `nanoid` dep resolved, connectivity/coordination tests pass, pattern generalizes beyond MSD | v1.2 |
| `@relay-assistant/memory` | `@agent-relay/memory` dep resolved; v1.1 milestone complete | v1.1 |

When `@relay-assistant/coordination` ships: coordinator/notifier/reviewer role dispatch may partially migrate to SDK coordination contracts. MSD's domain-specific specialist definitions and review workflows stay local regardless.

---

## Immediate Blockers

1. **Relay adapter wiring** — MSD's surface transport adapters must be identified and plumbed for inbound/outbound. This is required before any real code review messages flow through the assistant.
2. **Risk classifier implementation** — `msdClassifier` must be authored in product code before policy rules can produce meaningful decisions. The SDK accepts the classifier via `createActionPolicy({ classifier, auditSink })`; the taxonomy is entirely MSD-owned.
3. **Non-allow branch coverage** — `03-policy-gated-assistant.ts` only exercises the `allow` path. MSD should author its own integration scenarios that drive `deny` (e.g., `deploy_to_production` at critical risk) and `require_approval` (e.g., `merge_pr_to_main`) so these branches are **Demonstrated** rather than **Inspectable** in MSD's adoption proof.
4. **Multi-agent delegation** — MSD's coordinator/notifier/reviewer pattern must remain in product code until `@relay-assistant/coordination` ships. Do not attempt to replicate coordination semantics inside the policy package.
