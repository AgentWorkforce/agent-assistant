# `@agent-assistant/examples`

**Status:** REFERENCE_ONLY — not published to npm, not a production runtime package.

**Purpose:** Canonical reference assembly patterns for Agent Assistant SDK SDK consumers.

---

## What These Examples Are

Six TypeScript files showing how products compose the implemented SDK packages into working assistants. They start with a facade-first hello-world path, then progressively show deeper composition patterns. They should be read alongside the current consumer docs: the facade is the easiest front door, while turn-context, harness, memory, continuation, connectivity, coordination, and routing stay explicit when products need those seams.

These examples are adoption-oriented — they show real wiring patterns, make the product/SDK ownership boundary explicit, and provide realistic proof scenarios. They are not toy demos and not fake product implementations.

---

## Example Inventory

| # | File | Packages | What It Shows |
|---|---|---|---|
| 00 | `src/00-hello-world.ts` | `sdk` | Smallest facade-first install/import path. One package, one import surface, minimal assistant assembly. |
| 01 | `src/01-minimal-assistant.ts` | `sdk` | Smallest practical assembly using the top-level facade. Single `reply` capability, in-memory adapter stubs, full lifecycle. |
| 02 | `src/02-traits-assistant.ts` | `sdk` | Personality and formatting traits attached at definition time. Handlers read traits as data through the facade surface. |
| 03 | `src/03-policy-gated-assistant.ts` | `sdk` | Every reply gated through policy evaluation. Risk classification, rule priority order, all four decision branches (`allow`/`deny`/`require_approval`/`escalate`), audit trail. |
| 04 | `src/04-proactive-assistant.ts` | `sdk` | Proactive engine as a registered subsystem. Follow-up rules, watch rules, scheduler binding, engine retrieval from registry. |
| 05 | `src/05-full-assembly.ts` | `sdk` (+ direct imports only for excluded packages when needed) | Full facade-first assembly across the stable baseline packages. |

---

## Build Order

Examples now validate against the top-level facade package. Build the facade and its constituent packages first:

```bash
npm install
npm run build -w packages/core
npm run build -w packages/traits
npm run build -w packages/sessions
npm run build -w packages/surfaces
npm run build -w packages/policy
npm run build -w packages/proactive
npm run build -w packages/sdk
npm run typecheck -w packages/examples
```

The key consumer proof is that examples compile against `@agent-assistant/sdk` as the primary entrypoint.

---

## Proof Scenarios by Example

### Example 01 (core only)

| Scenario | How to verify |
|---|---|
| Inbound message dispatches to the correct capability | `outbound.sent[0].text` equals `"Echo: Hello, assistant!"` |
| Lifecycle: start → dispatch → stop | `runtime.start()` and `runtime.stop()` complete without error |
| Missing capability does not throw | `onError` hook receives the error; the runtime does not crash |

### Example 02 (core + traits)

| Scenario | How to verify |
|---|---|
| Traits are accessible after assembly | `runtime.definition.traits?.traits.voice` equals `"concise"` |
| Traits are frozen | `Object.isFrozen(runtime.definition.traits)` is `true` |
| Traits influence response formatting | `outbound.sent[0].text` starts with `"**Sage:**"` when `preferMarkdown: true` |
| Assembly without traits works unchanged | The `traits` field is optional; existing definitions need no modification |

### Example 03 (core + policy)

| Scenario | How to verify |
|---|---|
| Low-risk action is allowed through | `outbound.sent[0].text` contains the reply text |
| Every evaluation is audited | `auditSink.events.length > 0` after dispatch |
| `deny` decision produces a blocked response | Branching in capability handler emits denial text |
| `require_approval` notifies the user | Branching emits an approval-pending message |
| Rules evaluate in priority order | `blockCriticalRule` (priority 10) evaluates before `approveHighRiskRule` (priority 20) |

### Example 04 (core + proactive)

| Scenario | How to verify |
|---|---|
| Follow-up fires when idle threshold exceeded | `decisions[0].action === 'fire'` |
| Follow-up suppresses when conditions not met | Decisions include a `suppressionReason` field |
| Watch rule triggers on evaluation | `watchTriggers[0].ruleId === 'deploy-status-watch'` |
| Proactive engine is retrievable from registry | `runtime.get<ProactiveEngine>('proactive')` returns the engine |

### Example 05 (full assembly)

| Scenario | How to verify |
|---|---|
| Inbound reply passes through policy before emit | Outbound text is present only after `allow` decision |
| Traits-aware formatting applied to allowed replies | Outbound text includes `**Full:**` markdown prefix |
| Proactive follow-up fires and is bridged to policy | `followUpToAction()` produces an `Action`; `policyEngine.evaluate()` returns a result |
| Policy audits both inbound and proactive actions | `auditSink.events.length` covers both action types |
| All subsystems accessible from runtime | `runtime.get('policy')` and `runtime.get('proactive')` both succeed |
| No package imports another directly | Only product code (example file) references multiple packages — verified by inspection |

---

## Product / SDK Ownership Boundary

The examples make this boundary explicit and consistent:

| Concern | Owner | Present in |
|---|---|---|
| Adapter implementations (inbound, outbound) | **Product** | All examples |
| Trait value choices | **Product** | 02, 05 |
| Policy rule definitions | **Product** | 03, 05 |
| Proactive rule conditions and policies | **Product** | 04, 05 |
| Integration helpers (proactive → policy bridge) | **Product** | 05 |
| Action construction from messages | **Product** | 03, 05 |
| Decision branching (allow/deny/approve/escalate) | **Product** | 03, 05 |
| `createAssistant()` and runtime lifecycle | **SDK** | All examples |
| `createTraitsProvider()` and immutability | **SDK** | 02, 05 |
| `createActionPolicy()` and audit pipeline | **SDK** | 03, 05 |
| `createProactiveEngine()` and rule lifecycle | **SDK** | 04, 05 |
| Subsystem registry (`register` / `get`) | **SDK** | 04, 05 |

**Key invariant:** No example blurs this boundary. Product logic is explicit product code inside the example file. SDK behavior comes exclusively through package imports.

---

## Product Adoption Mapping

### Starting path by product

| Product | Start here | Target here | Packages | Deferred |
|---|---|---|---|---|
| **Sage** | 01 → 02 | 04 (then 05 when policy needed) | core, traits, proactive | policy (add when gating proactive actions) |
| **MSD** | 01 → 03 | 05 (when proactive added) | core, traits, policy | proactive (add in v1.2) |
| **NightCTO** | 01 → 05 | 05 | core, traits, policy, proactive | — (full assembly from start) |

### What each product replaces in the examples

| Concern | Examples provide | Product replaces with |
|---|---|---|
| Adapters | In-memory stubs | Relay foundation transport adapters |
| Trait values | Generic engineering defaults | Product-specific personality (Sage: knowledge-focused; MSD: review-focused; NightCTO: founder-facing) |
| Policy rules | Risk-level gating | Product business rules (MSD: review approval; NightCTO: client-tier policy) |
| Proactive rules | Idle detection, deploy watch | Product domain rules (Sage: knowledge follow-up; NightCTO: monitoring) |
| Integration helpers | Inlined `followUpToAction` | Product-owned orchestration layer |
| Scheduler binding | `InMemorySchedulerBinding` | Relay cron/scheduler substrate |
| Audit sink | `InMemoryAuditSink` | Product audit infrastructure |

---

## What Stays Outside

- Production product code
- Product-private adapters and transport layer wiring
- Cloud-hosted examples requiring non-OSS infrastructure
- Additional examples for deeper primitives such as turn-context, harness-first product wiring, memory/continuation, connectivity/coordination, and routing-specific assembly are still future expansion areas

---

## Consumer Guidance

**Read, copy, and adapt — do not depend.**

These examples are reference code. Use them to:
- Understand the canonical assembly pattern for any package combination
- Copy adapter stubs as starting points for your own adapter implementations
- Understand where product logic belongs vs. where SDK logic belongs
- Validate that your assembly is idiomatic before deeper integration

Do not import from this directory in production product code.

---

EXAMPLES_PACKAGE_READY
