# v1 Assistant Assembly Examples Contract

**Status:** DEFINED
**Date:** 2026-04-12
**Inputs:**
- `packages/core/README.md` — runtime API, lifecycle, dispatch, traits integration
- `packages/traits/README.md` — traits provider, validation, surface formatting
- `packages/policy/README.md` — action classification, gating, audit
- `packages/proactive/README.md` — follow-up rules, watch rules, scheduler bindings
- `packages/integration/src/helpers.ts` — proactive→policy bridge helpers
- `docs/consumer/how-to-build-an-assistant.md` — skeletal assembly pattern
- `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` — adoption sequence
- `docs/architecture/v1-proactive-policy-integration-contract.md` — proactive↔policy boundary
- `docs/architecture/v1-traits-core-integration-review-verdict.md` — traits-core integration status

**Purpose:** Define what assembly examples must exist in `packages/examples/`, what composition patterns they demonstrate, what proof scenarios they cover, and how they serve product adoption for Sage, MSD, and NightCTO.

---

## 1. Scope and Non-Scope

### In scope

Assembly examples that show how products compose implemented SDK packages into working assistants. The examples target the four packages with verified passing implementations:

- `@relay-assistant/core` (31 tests, `SPEC_RECONCILED`)
- `@relay-assistant/traits` (32 tests, `IMPLEMENTATION_READY`)
- `@relay-assistant/policy` (implemented, passing tests)
- `@relay-assistant/proactive` (implemented, passing tests)

Plus the integration helpers that bridge proactive decisions into policy evaluation (`packages/integration/src/helpers.ts`).

### Not in scope for v1 examples

- `@relay-assistant/sessions` — stable v1 baseline but assembly with sessions is already demonstrated in `docs/consumer/how-to-build-an-assistant.md`; adding session examples is deferred to avoid duplicating that doc
- `@relay-assistant/surfaces` — same rationale; surface registry assembly is documented elsewhere
- `@relay-assistant/connectivity`, `@relay-assistant/coordination` — tests blocked by missing dependencies; do not demonstrate packages that consumers cannot verify
- `@relay-assistant/memory` — placeholder; no implementation exists
- `@relay-assistant/routing` — DoD gap (12/40+ tests); do not demonstrate until resolved
- Cloud infrastructure, hosted adapters, or Relay foundation transport code

---

## 2. Required Examples

Five examples, numbered for progressive complexity. Each is a self-contained TypeScript file in `packages/examples/src/`.

### Example 01: Minimal Assistant (core only)

**File:** `src/01-minimal-assistant.ts`

**Package set:** `@relay-assistant/core`

**What it demonstrates:**
- Smallest possible `createAssistant()` call with a single `reply` capability
- Product-owned inbound and outbound adapters (in-memory stubs)
- Runtime lifecycle: `start()` → `dispatch()` → `emit()` → `stop()`
- The `onError` hook for error observability
- Inbound message shape matching `InboundMessage` contract

**Product-owned in this example:**
- Adapter implementations (inbound push, outbound collect)
- Capability handler logic (echo behavior)
- Message simulation

**SDK-owned in this example:**
- `createAssistant()` validation, definition freezing, lifecycle state machine
- Dispatch queue, concurrency limiting, timeout handling
- `emit()` targeted send via outbound adapter

**Adoption value:** Establishes the baseline mental model. Every product starts here. Sage, MSD, and NightCTO all need this exact pattern as their assistant construction foundation.

---

### Example 02: Traits-Aware Assistant

**File:** `src/02-traits-assistant.ts`

**Package set:** `@relay-assistant/core` + `@relay-assistant/traits`

**What it demonstrates:**
- `createTraitsProvider()` with personality traits and surface formatting preferences
- Traits attached to `AssistantDefinition.traits` at assembly time
- Core freezes and stores the provider without interpreting trait values
- Capability handlers read traits as data and make formatting decisions
- Trait immutability after assembly (frozen on `runtime.definition.traits`)

**Product-owned in this example:**
- Trait value choices (voice, formality, domain, vocabulary)
- Surface formatting preferences
- How traits influence response formatting (capability-level logic)

**SDK-owned in this example:**
- `createTraitsProvider()` validation
- `TraitsProvider` immutability contract
- Core stores and freezes — never interprets

**Adoption value:** Shows Sage, MSD, and NightCTO how to encode assistant personality as declarative data rather than scattering style logic across handlers. Each product chooses different trait values but uses the same composition pattern.

---

### Example 03: Policy-Gated Assistant

**File:** `src/03-policy-gated-assistant.ts`

**Package set:** `@relay-assistant/core` + `@relay-assistant/policy`

**What it demonstrates:**
- `createActionPolicy()` with an `InMemoryAuditSink`
- Product-defined `PolicyRule` implementations (block critical, approve high-risk)
- Rule priority ordering (lower evaluates first)
- Building a policy `Action` from an `InboundMessage` inside a capability handler
- Branching on `EvaluationResult.decision.action` (`allow`, `deny`, `require_approval`, `escalate`)
- Audit sink captures every evaluation

**Product-owned in this example:**
- Policy rules — what risk levels trigger what decisions
- Action construction — how inbound messages map to policy actions
- Decision branching — what the assistant does after allow/deny/approval/escalate
- Approval hint content (approver, timeout, prompt)

**SDK-owned in this example:**
- `createActionPolicy()` engine creation and rule evaluation pipeline
- Risk classification via `defaultRiskClassifier` or injected classifier
- `InMemoryAuditSink` for development/testing audit capture
- `EvaluationResult` with `auditEventId` for correlation

**Adoption value:** MSD and NightCTO both need action gating — MSD for code review operations, NightCTO for client-tier policy. This example shows the exact wiring pattern. Sage benefits when proactive follow-ups need gating in v1.2.

---

### Example 04: Proactive Assistant

**File:** `src/04-proactive-assistant.ts`

**Package set:** `@relay-assistant/core` + `@relay-assistant/proactive`

**What it demonstrates:**
- `createProactiveEngine()` with `InMemorySchedulerBinding`
- Follow-up rules: condition function, reminder policy, routing hints, message templates
- Watch rules: condition function, interval, action type/payload
- Registering the proactive engine as a runtime subsystem via `runtime.register('proactive', engine)`
- Evaluating follow-ups from scheduler-triggered context (not from inbound messages)
- Evaluating watch rules and inspecting triggers
- Retrieving the engine from the subsystem registry

**Product-owned in this example:**
- Follow-up rule conditions (idle detection threshold)
- Watch rule conditions (deploy status check)
- Reminder policy parameters (max reminders, cooldown, suppress-when-active)
- Scheduler binding implementation (in-memory for examples; product provides real scheduler)
- What happens when a follow-up fires or a watch triggers

**SDK-owned in this example:**
- `createProactiveEngine()` rule lifecycle and evaluation
- Reminder state tracking (count, cooldown, suppression)
- Watch rule scheduling, pause/resume/cancel lifecycle
- `InMemorySchedulerBinding` for development/testing

**Adoption value:** Sage and NightCTO both need proactive re-engagement. This example shows the engine wiring without policy gating, establishing the proactive pattern before the full assembly adds policy to the mix.

---

### Example 05: Full Assembly

**File:** `src/05-full-assembly.ts`

**Package set:** `@relay-assistant/core` + `@relay-assistant/traits` + `@relay-assistant/policy` + `@relay-assistant/proactive`

**What it demonstrates:**
- All four packages composed into a single assistant
- Traits influence response formatting in capability handlers
- Every reply gated through policy evaluation before emit
- Proactive follow-up decisions bridged to policy actions via integration helpers (`followUpToAction()`, `watchTriggerToAction()`)
- Policy evaluates proactive actions the same way it evaluates user-initiated actions
- Subsystem registry holds both policy and proactive engines
- Audit trail covers both inbound replies and proactive actions
- The complete assembly and initialization sequence

**Product-owned in this example:**
- Integration helpers (`followUpToAction`, `watchTriggerToAction`) — inlined to show the bridge is product-owned
- All policy rules, proactive rules, trait values
- Orchestration: when to evaluate follow-ups, how to act on policy decisions
- The decision to emit or suppress after policy evaluation

**SDK-owned in this example:**
- Each package's factory function and runtime contract
- No package imports another directly — composition happens in product code
- Audit correlation across the full flow

**Adoption value:** This is the canonical reference for how NightCTO (all four packages), Sage (core + traits + proactive, with policy later), and MSD (core + traits + policy, with proactive later) should structure their full assembly. Products adopt subsets of this pattern based on which packages they need.

---

## 3. Product-Owned vs. SDK-Owned Boundary

The examples must make this boundary explicit and consistent:

| Concern | Owner | Where it appears |
|---|---|---|
| Adapter implementations (inbound, outbound) | Product | All examples |
| Trait value choices | Product | Examples 02, 05 |
| Policy rule definitions | Product | Examples 03, 05 |
| Proactive rule conditions and policies | Product | Examples 04, 05 |
| Integration helpers (proactive→policy bridge) | Product | Example 05 |
| Action construction from messages | Product | Examples 03, 05 |
| Decision branching (allow/deny/approve/escalate) | Product | Examples 03, 05 |
| `createAssistant()` and runtime lifecycle | SDK | All examples |
| `createTraitsProvider()` and immutability | SDK | Examples 02, 05 |
| `createActionPolicy()` and audit pipeline | SDK | Examples 03, 05 |
| `createProactiveEngine()` and rule lifecycle | SDK | Examples 04, 05 |
| Subsystem registry (`register`/`get`) | SDK | Examples 04, 05 |

**Key invariant:** No example should blur this boundary. Product logic stays in the example file as explicit product code. SDK behavior comes exclusively through package imports.

---

## 4. Proof Scenarios

Each example must demonstrate verifiable behavior, not just compile. The following scenarios must be exercisable by running the example or by inspection:

### Example 01 proof scenarios

| # | Scenario | Verifiable by |
|---|---|---|
| P1.1 | Inbound message dispatches to the correct capability | Outbound event contains echoed text |
| P1.2 | Runtime lifecycle is correct | `start()` succeeds, `stop()` completes without error |
| P1.3 | Missing capability does not throw from dispatch | `onError` hook receives the error (documented in comments) |

### Example 02 proof scenarios

| # | Scenario | Verifiable by |
|---|---|---|
| P2.1 | Traits are accessible on `runtime.definition.traits` after assembly | Console output shows trait values |
| P2.2 | Traits are frozen (immutable) | `Object.isFrozen(runtime.definition.traits)` is true |
| P2.3 | Capability handler reads traits and formats response accordingly | Outbound text includes markdown formatting when `preferMarkdown` is true |
| P2.4 | Assembly without traits still works | Documented: `traits` field is optional on `AssistantDefinition` |

### Example 03 proof scenarios

| # | Scenario | Verifiable by |
|---|---|---|
| P3.1 | Low-risk action is allowed through | Outbound event contains reply text |
| P3.2 | Policy engine audits every evaluation | `auditSink.events.length` > 0 after dispatch |
| P3.3 | `deny` decision produces a blocked response | Documented branching in capability handler |
| P3.4 | `require_approval` decision notifies the user | Documented branching with approval hint |
| P3.5 | Rules evaluate in priority order | `blockCriticalRule` (priority 10) evaluates before `approveHighRiskRule` (priority 20) |

### Example 04 proof scenarios

| # | Scenario | Verifiable by |
|---|---|---|
| P4.1 | Follow-up fires when idle threshold exceeded | `evaluateFollowUp()` returns decision with `action: 'fire'` |
| P4.2 | Follow-up suppresses when conditions are not met | Documented: `suppressionReason` field on suppressed decisions |
| P4.3 | Watch rule triggers on evaluation | `evaluateWatchRules()` returns triggers with action type |
| P4.4 | Proactive engine is retrievable from subsystem registry | `runtime.get('proactive')` returns the engine |

### Example 05 proof scenarios

| # | Scenario | Verifiable by |
|---|---|---|
| P5.1 | Inbound reply passes through policy before emit | Outbound text present only after `allow` decision |
| P5.2 | Traits-aware formatting applied to allowed replies | Outbound text includes markdown when trait is set |
| P5.3 | Proactive follow-up fires and is bridged to policy | `followUpToAction()` produces an `Action`, `policyEngine.evaluate()` returns a result |
| P5.4 | Policy audits both inbound and proactive actions | `auditSink.events.length` covers both action types |
| P5.5 | All subsystems accessible from runtime | `runtime.get('policy')` and `runtime.get('proactive')` succeed |
| P5.6 | No package imports another directly | Verified by inspection: only product code references multiple packages |

---

## 5. Product Adoption Mapping

### How each product uses these examples

| Product | Starting example | Target example | Packages adopted | Deferred |
|---|---|---|---|---|
| **Sage** | 01 → 02 | 04 (then 05 when policy needed) | core, traits, proactive | policy (adopt when gating proactive actions) |
| **MSD** | 01 → 03 | 05 (when proactive added) | core, traits, policy | proactive (adopt in v1.2) |
| **NightCTO** | 01 → 05 | 05 | core, traits, policy, proactive | — (full assembly from start) |

### Adoption path by example

**Example 01** is the universal starting point. Every product begins here to validate their adapter wiring and basic runtime lifecycle.

**Example 02** is the second step for all products. Trait declaration is lightweight and establishes assistant identity early.

**Example 03** is the priority path for MSD. Code review operations need action classification and approval workflows before proactive behavior matters.

**Example 04** is the priority path for Sage. Follow-up and idle re-engagement are core Sage behaviors that should adopt the proactive engine contract early.

**Example 05** is the target state for NightCTO and the eventual convergence point for Sage and MSD. It shows the canonical composition of all four packages with the proactive→policy bridge that every product eventually needs.

### What each product takes from examples vs. what they replace

| Concern | Example provides | Product replaces with |
|---|---|---|
| Adapters | In-memory stubs | Relay foundation transport adapters |
| Trait values | Generic engineering defaults | Product-specific personality (Sage: knowledge-focused; MSD: review-focused; NightCTO: founder-facing) |
| Policy rules | Risk-level gating | Product business rules (MSD: review approval rules; NightCTO: client-tier policy) |
| Proactive rules | Idle detection, deploy watch | Product domain rules (Sage: knowledge follow-up; NightCTO: monitoring) |
| Integration helpers | Inlined `followUpToAction` | Product-owned orchestration layer |
| Scheduler binding | `InMemorySchedulerBinding` | Relay cron/scheduler substrate |
| Audit sink | `InMemoryAuditSink` | Product audit infrastructure |

---

## 6. Package and Build Requirements

### Package structure

```
packages/examples/
├── package.json          # private, devDependencies on all four SDK packages
├── tsconfig.json         # strict, noEmit, NodeNext resolution
├── README.md             # example inventory, build order, consumer guidance
└── src/
    ├── 01-minimal-assistant.ts
    ├── 02-traits-assistant.ts
    ├── 03-policy-gated-assistant.ts
    ├── 04-proactive-assistant.ts
    └── 05-full-assembly.ts
```

### Package configuration

- `private: true` — examples are never published to npm
- Dependencies via `file:` links to sibling packages (monorepo-local resolution)
- `npm run typecheck` as the only script (`tsc --noEmit`)
- No test runner — examples are reference code, not a test suite
- No build output — `noEmit: true` in tsconfig

### Build order

Examples depend on built output from all four packages. Required build order:

1. `packages/traits` — leaf package, no upstream dependencies
2. `packages/core` — depends on traits types
3. `packages/policy` — independent of core/traits
4. `packages/proactive` — independent of core/traits/policy
5. `packages/examples` — typecheck only, depends on all four

Steps 3 and 4 can run in parallel.

### Verification

The examples pass verification when:

1. `npm run typecheck` in `packages/examples` exits with code 0 (no type errors)
2. All four upstream packages build successfully before typecheck
3. No example imports from source paths (`../../traits/src/...`) — all imports use package names (`@relay-assistant/traits`)

---

## 7. Deferred from v1 Examples

The following are explicitly out of scope for the v1 example set:

| Deferred item | Reason | Target milestone |
|---|---|---|
| Sessions + surfaces assembly | Already documented in `docs/consumer/how-to-build-an-assistant.md`; avoid duplication | v1.1 examples |
| End-to-end runnable examples | v1 examples are reference TypeScript, not executable scripts with real adapters | v1.1 |
| Memory integration example | `@relay-assistant/memory` is placeholder; no implementation to compose | v1.1 |
| Coordination + connectivity example | Tests blocked by missing dependencies; do not demonstrate unverifiable packages | v1.2 |
| Routing example | DoD gap (12/40+ tests); do not demonstrate until resolved | v1.1 |
| Multi-surface fanout in examples | Requires sessions + surfaces composition not in v1 example scope | v1.1 |
| Watch-trigger policy gating example | Proactive-policy integration review flagged incomplete watch-trigger coverage; defer detailed watch→policy examples until contract reconciliation completes | v1.1 |
| Reminder state + policy denial interaction | Review verdict identified contract/implementation disagreement on whether denied follow-ups count against reminder state; defer example coverage until semantics reconciled | v1.1 |
| Approval resolution flow example | Policy supports `recordApproval()` but the full approval UX flow depends on product infrastructure not yet generalized | v1.2 |

---

## 8. Relationship to Existing Documentation

These examples complement, not replace, existing docs:

| Document | Role | Examples role |
|---|---|---|
| `docs/consumer/how-to-build-an-assistant.md` | Architectural guidance, skeletal assembly with sessions + surfaces | Concrete, runnable-shape composition with traits + policy + proactive |
| `docs/consumer/how-products-should-adopt-relay-agent-assistant.md` | Adoption sequence and decision rules | Examples demonstrate the "what" behind the adoption "how" |
| `docs/architecture/v1-proactive-policy-integration-contract.md` | Formal boundary contract | Example 05 is the reference implementation of the contract's orchestration pattern |
| `docs/architecture/v1-traits-core-integration-review-verdict.md` | Review findings on traits-core boundary | Example 02 demonstrates the correct assembly pattern; Example 05 shows traits in full composition |
| Package READMEs | Per-package API reference | Examples show cross-package composition that no single README covers |

---

## 9. Success Criteria

The v1 assembly examples contract is met when:

1. All five example files exist in `packages/examples/src/` and typecheck cleanly
2. Each example composes only the package set specified in this contract
3. Product-owned vs. SDK-owned concerns are clearly separated in each example
4. All proof scenarios from §4 are demonstrable by running the example or by code inspection
5. The README in `packages/examples/` documents the example inventory, build order, and consumer guidance
6. No example imports from source paths — all use published package names
7. The `packages/examples/package.json` is `private: true` with `file:` dependencies

---

V1_ASSISTANT_ASSEMBLY_EXAMPLES_CONTRACT_READY
