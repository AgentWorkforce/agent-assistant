# SDK Audit and Traits Alignment Plan

**Date:** 2026-04-11
**Scope:** Audit implemented vs. specified state, identify docs drift, define workforce persona ↔ assistant traits relationship, place a traits layer in the package map, and update workspace guidance for future workflows.

---

## 1. Implementation vs. Specification Status

### Implemented and passing tests (6 packages)

| Package | Tests | Key exports | Spec status |
| --- | --- | --- | --- |
| `@relay-assistant/core` | 44 pass | `createAssistant`, `AssistantDefinition`, `AssistantRuntime`, `InboundMessage`, `OutboundEvent`, adapter interfaces, error classes | `SPEC_RECONCILED` — matches `v1-core-spec.md` |
| `@relay-assistant/sessions` | 25 pass | `createSessionStore`, `InMemorySessionStoreAdapter`, `resolveSession`, `defaultAffinityResolver`, `Session`, lifecycle types | `IMPLEMENTATION_READY` — matches `v1-sessions-spec.md` |
| `@relay-assistant/surfaces` | 28 pass | `createSurfaceRegistry`, `SurfaceConnection`, `SurfaceAdapter`, `SurfaceCapabilities`, `FanoutResult`, error classes | `SPEC_RECONCILED` — matches `v1-surfaces-spec.md` |
| `@relay-assistant/routing` | 12 pass | `createRouter`, `RoutingMode`, `ModelSpec`, `RoutingDecision`, `DEFAULT_MODE_SPECS`, cost tracking | `IMPLEMENTATION_READY` — matches `v1-routing-spec.md`; test count below 40+ DoD target |
| `@relay-assistant/connectivity` | 87 pass | `createConnectivityLayer`, signal types, message classes, suppression, audience resolution | `IMPLEMENTATION_READY` — matches `v1-connectivity-spec.md` |
| `@relay-assistant/coordination` | 45 pass | `createCoordinator`, `createDelegationPlan`, `createSpecialistRegistry`, `createSynthesizer`, routing integration | Implemented and hardened; routing integration reviewed |

**Total: 241 tests, all passing.**

### Specified but not yet implemented (4 packages)

| Package | Spec exists? | README placeholder? | Notes |
| --- | --- | --- | --- |
| `@relay-assistant/memory` | Yes — `v1-memory-spec.md` (`IMPLEMENTATION_READY`) | Yes | Scopes, stores, promotion, compaction defined. Sage is primary extraction signal. Roadmap: v1.1. |
| `@relay-assistant/policy` | No formal spec | Yes | Approvals, safeguards, risk classification, audit hooks described in boundary map. MSD and NightCTO are extraction signals. |
| `@relay-assistant/proactive` | No formal spec | Yes | Follow-up engines, watchers, scheduler bindings described. Sage and NightCTO are signals. |
| `@relay-assistant/examples` | N/A | Yes | Reference adoption examples; not production code. |

### Not yet specified or implemented

| Package | Status |
| --- | --- |
| `@relay-assistant/traits` (proposed — see §4) | Does not exist. No spec, no types, no placeholder. |

### Infrastructure gaps

- **No root `package.json` or monorepo workspace config.** Each package is independently installable. The weekend delivery plan references `workspace:*` protocol, but no workspace root exists.
- **No shared vitest config or build script.** Each package builds and tests independently.
- **README.md `Current Status` section is stale.** It says "no implementation packages yet" — 6 packages are fully implemented with 165 passing tests.

---

## 2. Docs Gaps and Drift to Fix Now

### Critical drift (fix before next workflow)

| # | Issue | Location | Fix |
| --- | --- | --- | --- |
| D-1 | README says "no implementation packages yet" | `README.md` → Current Status | Update to list the 6 implemented packages, their test counts, and spec alignment status. |
| D-2 | README package map omits `routing`, `connectivity`, `coordination` implementation status | `README.md` → Package Map | Add implementation status column; mark 6 implemented, 4 placeholder. |
| D-3 | Routing test count (12) is below DoD (40+) per `v1-routing-review-verdict.md` F-1 | `packages/routing/src/routing.test.ts` | Bring to 40+ before any product integration. This is the single blocking DoD failure across all packages. |
| D-4 | Routing `escalated` flag incorrect on hard-constraint caps (F-2) | `packages/routing/src/routing.ts` | Change `escalated` to `candidate.escalated` only — do not OR with ceiling comparison. |
| D-5 | Weekend delivery plan references `workspace:*` protocol, but no root `package.json` exists | `docs/workflows/weekend-delivery-plan.md` | Either create root workspace config or update the plan to document the actual install mechanism. |

### Moderate drift (fix within next 2 workflows)

| # | Issue | Location | Fix |
| --- | --- | --- | --- |
| D-6 | Escalation-routing pipeline is dormant: coordinator does not pass `activeEscalations` to `router.decide()` | `packages/coordination/src/coordination.ts` | Document as v1 known gap. Wire in v1.1 when connectivity-routing integration matures. |
| D-7 | OQ-5 escalation tiebreaker (deepest mode wins within same priority) is undocumented | `docs/specs/v1-routing-spec.md` or routing README | Add explicit note. Implementation is defensible; just needs to be recorded. |
| D-8 | `v1-workflow-backlog.md` WF-7 references updating READMEs — not yet done for any implemented package | Package READMEs | Update core, sessions, surfaces, routing, connectivity, coordination READMEs with real API docs. |
| D-9 | `AssistantDefinition` has only `id`, `name`, `description?` as identity fields — no traits, persona, or voice fields | `packages/core/src/types.ts` | Intentional for v1. The traits layer (§4) will extend this without bloating core. |

### Low-priority drift

| # | Issue | Location | Fix |
| --- | --- | --- | --- |
| D-10 | `tsconfig.json` in routing and coordination missing `declarationMap`, `sourceMap`, test exclusion | Per-package `tsconfig.json` | Align to plan template when doing next build pass. |
| D-11 | Coordination README not updated with routing integration section | `packages/coordination/README.md` | Add routing integration section per integration plan DoD. |

---

## 3. Workforce Personas vs. Assistant Traits/Persona

### They are different things solving different problems

**Workforce personas** are runtime execution profiles. A persona defines:
- a system prompt
- a model
- a harness (Claude, Codex, OpenCode)
- harness settings
- optional skills
- service tiers (`best`, `best-value`, `minimum`)

Personas answer: **"What runtime configuration should this agent use to execute a task?"**

A routing profile selects which persona tier to use per intent. The workload-router resolves `intent → persona + tier → concrete runtime config`.

**Assistant traits** are identity and behavioral characteristics. Traits would define:
- voice and communication style
- domain vocabulary and framing
- behavioral defaults (proactivity level, formality, risk tolerance)
- formatting preferences per surface
- personality continuity across sessions

Traits answer: **"How should this assistant present itself and behave across interactions?"**

### Relationship without collapse

```
workforce persona (runtime config)     assistant traits (identity + behavior)
         │                                        │
         ▼                                        ▼
  ┌─────────────┐                        ┌──────────────┐
  │ model        │                        │ voice         │
  │ harness      │                        │ style         │
  │ system prompt│◄── prompt may embed ───│ vocabulary    │
  │ tier policy  │    trait values         │ proactivity   │
  │ skills       │                        │ risk posture  │
  └─────────────┘                        └──────────────┘
```

- A workforce persona's `systemPrompt` may **embed** trait values (e.g., "You are Sage, a knowledge-focused assistant who speaks concisely"), but the prompt itself is a persona concern — it is the execution-time artifact.
- Traits are the **source data** that multiple prompts, formatters, and behavioral policies can read from.
- A single assistant identity (e.g., "Sage") may be served by multiple workforce personas at different tiers, but the traits remain constant across all tiers.
- Products compose traits into personas, not the other way around.

### Integration points

| Concern | Owner | Consumes traits? |
| --- | --- | --- |
| Persona resolution (`resolvePersona`) | Workforce workload-router | No — personas are self-contained runtime configs. Products may inject trait values into prompt templates before passing to the persona. |
| Routing mode selection (`router.decide()`) | `@relay-assistant/routing` | No — routing is about depth/latency/cost, not identity. |
| Surface formatting (`formatHook`) | `@relay-assistant/surfaces` | Yes — a format hook may read traits to adjust voice, block style, or formality per surface. |
| Session continuity | `@relay-assistant/sessions` | No — sessions track state, not identity. |
| Coordination synthesis | `@relay-assistant/coordination` | Yes — a synthesizer may read traits to maintain consistent voice when merging specialist outputs. |
| Proactive behavior (future) | `@relay-assistant/proactive` | Yes — traits like proactivity level and risk posture inform watch rules and follow-up thresholds. |

### What this means for implementations

Products should:
1. Define traits as a data object (not a package import in v1 — this is product-owned for now)
2. Pass trait values into persona prompts, format hooks, and synthesizer configs as needed
3. Not expect the assistant SDK to enforce trait consistency — that is the product's responsibility until a traits package exists

---

## 4. Where a Traits Layer Should Live

### Proposed package: `@relay-assistant/traits`

**Position in the package map:**

| Package | Purpose |
| --- | --- |
| `@relay-assistant/core` | Assistant definition, lifecycle, runtime composition |
| **`@relay-assistant/traits`** | **Assistant identity traits: voice, style, vocabulary, behavioral defaults, surface formatting preferences** |
| `@relay-assistant/memory` | Memory scopes, stores, retrieval, promotion |
| `@relay-assistant/sessions` | Session identity, lifecycle, surface attachment |
| `@relay-assistant/surfaces` | Surface abstractions, normalization, fanout |
| `@relay-assistant/coordination` | Specialist orchestration, synthesis |
| `@relay-assistant/connectivity` | Inter-agent signaling, convergence |
| `@relay-assistant/routing` | Depth/latency/cost mode selection |
| `@relay-assistant/proactive` | Follow-ups, watchers, schedulers |
| `@relay-assistant/policy` | Approvals, safeguards, audit |

### Package scope

`@relay-assistant/traits` should own:

- `AssistantTraits` type definition (voice, style, vocabulary, proactivity level, risk posture, formality, domain framing)
- `SurfaceFormattingTraits` type definition (per-surface-type formatting preferences that inform format hooks)
- `TraitsProvider` interface — a read-only accessor that packages can consume without hard-depending on traits
- `createTraitsProvider(traits: AssistantTraits)` factory
- Validation that trait values are within acceptable ranges/enums

`@relay-assistant/traits` must NOT own:

- Persona definitions — those stay in workforce
- System prompts — those are persona artifacts, not traits
- Product-specific behavioral logic — stays in product repos
- Model selection or routing — stays in `routing`
- Memory or session state — stays in those packages

### Dependency direction

```
traits ← core (optional: definition may reference a TraitsProvider)
traits ← surfaces (optional: format hooks may consume traits)
traits ← coordination (optional: synthesizer may consume traits)
traits ← proactive (optional: watch rules may consume traits)
```

Traits has **zero upstream dependencies** on other SDK packages. It is a leaf data package.

### Integration with `AssistantDefinition`

The current `AssistantDefinition` has `id`, `name`, `description?`. When traits ships:

```typescript
export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;  // NEW — optional, from @relay-assistant/traits
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
```

The `traits?` field is optional so existing consumers are unaffected. Products that want trait-driven formatting, synthesis, or proactive behavior wire a `TraitsProvider` at definition time. Packages that consume traits access it via `runtime.definition.traits`.

### Timeline

- **v1 (now):** No traits package. Products define traits as local data objects. This is fine for the current adoption phase.
- **v1.1 (with memory):** Memory may begin storing trait-like user preferences, but `AssistantDefinition` still does not gain a `traits` field at this stage. Keep trait objects product-local until the traits package exists.
- **v1.2 (with proactive + coordination maturity):** Traits package implementation. By this point, multiple products will have local trait patterns worth extracting.

### Extraction signal

The same rule that governs all SDK extraction applies: if a capability is reusable across multiple assistants with only configuration changes, it belongs here. When Sage, MSD, and NightCTO all have local trait objects with overlapping field shapes, the extraction is justified.

---

## 5. Workspace Guidance Updates

### Updates needed so future workflows stay aligned

| # | Location | Current state | Required update |
| --- | --- | --- | --- |
| G-1 | `README.md` → Current Status | Says "no implementation packages yet" | Reflect 6 implemented packages (core, sessions, surfaces, routing, connectivity, coordination), 165 passing tests, 4 placeholder packages (memory, policy, proactive, examples) |
| G-2 | `README.md` → Package Map | No status indicators | Add implementation status column per package |
| G-3 | `README.md` → Package Map | Missing `traits` | Add `@relay-assistant/traits` row with "planned — v1.2" status and purpose: "Assistant identity traits, voice, style, behavioral defaults" |
| G-4 | `docs/architecture/package-boundary-map.md` | No `traits` section | Add `@relay-assistant/traits` boundary definition (§4 above). Clarify that traits are distinct from workforce personas. |
| G-5 | `docs/architecture/package-boundary-map.md` → Core section | "assistant identity fields shared across packages" is vague | Clarify: core owns `id`, `name`, `description`. Traits (voice, style, behavior) will live in `@relay-assistant/traits` when extracted. |
| G-6 | `docs/architecture/extraction-roadmap.md` | May not reflect current implementation state | Update to show that 6 packages are implemented. Add traits extraction as a v1.2 milestone. |
| G-7 | `docs/consumer/how-to-build-an-assistant.md` | May reference unimplemented APIs or stale terminology | Verify examples match actual exported APIs from implemented packages. |
| G-8 | `docs/workflows/v1-workflow-backlog.md` | WF-1 through WF-7 described; no status | Mark WF-1 through WF-5 as COMPLETE (all implemented and passing). Mark WF-6 and WF-7 status based on whether integration tests exist. |
| G-9 | `docs/architecture/v1-routing-review-verdict.md` | F-1 (test count) and F-2 (escalated flag) still open | These must be resolved before routing is consumed by products. Future workflows touching routing should gate on these. |
| G-10 | Future workflow templates | No standard reference to traits or persona context | Future workflows that touch identity, formatting, or behavioral consistency should reference this document and check whether the traits package exists yet. |

### Guidance for workforce ↔ SDK alignment in future workflows

1. **Never import workforce personas into the assistant SDK.** Personas are runtime configs owned by workforce. The SDK provides traits (identity data) and routing (mode selection). Products compose these at the integration boundary.

2. **Routing mode names (`cheap`/`fast`/`deep`) are SDK vocabulary, not workforce vocabulary.** Workforce uses `minimum`/`best-value`/`best` for tier names. The mapping is intentional and explicit — products map between them. Neither package should adopt the other's naming.

3. **Traits are not prompts.** A trait like `voice: "concise"` is a data value. The prompt that says "Respond concisely" is a persona artifact. Products turn traits into prompt fragments; the SDK does not.

4. **The `AssistantDefinition.traits?` field does not exist yet** and must not be added until the traits package ships in v1.2. Keep local trait objects in product code rather than tunneling them through unrelated core fields.

---

## Summary of Actions

### Immediate (before next workflow)

1. Update `README.md` current status and package map (D-1, D-2, G-1, G-2, G-3)
2. Fix routing `escalated` flag bug (D-4)
3. Bring routing tests to 40+ (D-3)

### Near-term (within next 2 workflows)

4. Add `@relay-assistant/traits` section to `package-boundary-map.md` (G-4, G-5)
5. Update package READMEs with real API docs (D-8)
6. Update workflow backlog with implementation status (G-8)
7. Document escalation-routing gap and OQ-5 tiebreaker (D-6, D-7)
8. Create root workspace config or update delivery plan to match reality (D-5)

### v1.2 milestone

9. Write traits spec based on extracted patterns from Sage, MSD, and NightCTO
10. Implement `@relay-assistant/traits` package
11. Add optional `traits?: TraitsProvider` to `AssistantDefinition` when `@relay-assistant/traits` exists in v1.2
12. Wire traits into surfaces format hooks and coordination synthesizers

---

SDK_AUDIT_ALIGNMENT_PLAN_READY
