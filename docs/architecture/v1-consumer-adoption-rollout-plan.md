# v1 Consumer Adoption Rollout Plan

**Date:** 2026-04-12
**Contract:** `docs/architecture/v1-consumer-adoption-contract.md`
**Weekend goal:** Get at least one consumer wired against the real SDK — proving the full composition path works outside of the examples package.

---

## Recommendation: NightCTO First

**NightCTO is the correct first adopter for the weekend goal.**

Rationale follows from four independent reasons. Any one of them would be sufficient; together they are definitive.

### Reason 1: Full package coverage in one adoption

NightCTO uses all four ready-now packages: `core`, `traits`, `policy`, and `proactive`. No other consumer exercises all four at v1.

This means a successful NightCTO adoption proves:
- The four-package composition path works end-to-end
- No hidden incompatibility exists between the packages when composed together
- The `05-full-assembly.ts` example is a true copy-adapt template, not just a plausible sketch

Sage and MSD each exercise three packages. Starting with either one would leave the hardest composition pattern (four packages together) unvalidated until NightCTO's turn — which means both subsequent adoptions carry unknown risk.

### Reason 2: Proactive→policy bridge is proven first

The proactive→policy bridge (`followUpToAction` converting a proactive `fire` decision into an `Action` evaluated by `policyEngine.evaluate()`) is the hardest composition pattern in the SDK. It requires both engines to be wired, the bridge function to be product-owned, and the audit trail to capture both inbound-originated and proactive-originated actions.

Both Sage and MSD will need this bridge eventually (Sage at v1.2 when proactive actions need gating; MSD at v1.2 when proactive PR follow-up ships). If NightCTO proves this pattern first, Sage and MSD can copy the validated bridge pattern rather than re-inventing it.

Starting with Sage or MSD leaves the bridge unproven until the third adoption.

### Reason 3: `05-full-assembly.ts` exists as the canonical reference

The full-assembly example already exists and was built with NightCTO's architecture in mind. NightCTO adoption is mechanical: read `05-full-assembly.ts`, replace each in-memory stub with the concrete Relay adapter, replace example trait values and rules with NightCTO domain values.

There is no design work required. The pattern is already established. This is the fastest path from "reading docs" to "real wiring" for any consumer.

### Reason 4: NightCTO success de-risks both subsequent adoptions

If NightCTO adoption succeeds, Sage and MSD each inherit:
- Validated proof that the assembly pattern works outside the examples package
- A working proactive→policy bridge they can copy when they need it
- Identified wiring issues (Relay adapter surface, audit sink shape) that will recur for all consumers

If NightCTO adoption reveals a problem in the SDK, that problem surfaces before Sage and MSD invest adoption effort. The risk of discovering a blocking issue late drops significantly.

---

## Rollout Sequence

### Phase 1: NightCTO (this weekend)

**Goal:** Wire `05-full-assembly.ts` against NightCTO domain values and Relay foundation adapters. Prove the full four-package composition outside the examples package.

**Steps:**
1. Copy the `05-full-assembly.ts` pattern into NightCTO product code
2. Replace `InMemorySchedulerBinding` with Relay cron substrate
3. Replace `InMemoryAuditSink` with NightCTO's audit infrastructure (or keep in-memory for initial wiring, replace before production)
4. Replace inbound/outbound in-memory stubs with NightCTO's Relay transport adapters
5. Define NightCTO trait values (formal, assertive, executive-advisory vocabulary)
6. Define at least two policy rules: `block-cross-client-data` and `escalate-critical`
7. Define at least one proactive follow-up rule: `client-status-check-in` with 12h idle condition
8. Wire `followUpToAction` bridge in product code
9. Walk through proof checklist in `docs/consumer/nightcto-adoption-path.md`

**Success criteria:**
- `runtime.start()` and `runtime.stop()` complete without error
- One inbound message routes through `reply` capability and exits policy with `allow` decision
- One proactive evaluation produces a `fire` decision, bridges to an `Action`, and exits policy
- Audit trail shows entries from both inbound and proactive origins
- All four policy decision branches have handling code (deny/require_approval/escalate may be stubbed)

**Known gap to track:** Watch-trigger-to-policy path is not yet covered by `05-full-assembly.ts`. NightCTO implements this product-side as a Planned item. Do not block weekend goal on this — track and resolve in a follow-up.

**Estimated blockers to resolve first:**
- Identify the concrete Relay inbound/outbound adapter classes for NightCTO's transport
- Confirm Relay cron substrate interface matches `InMemorySchedulerBinding` API surface
- Confirm NightCTO audit infrastructure sink interface or keep in-memory for initial pass

---

### Phase 2: Sage (next sprint after NightCTO)

**Goal:** Wire `04-proactive-assistant.ts` against Sage domain values and Relay foundation adapters. Prove the proactive engine with workspace-specific follow-up conditions.

**Steps:**
1. Copy the `04-proactive-assistant.ts` pattern into Sage product code (step through 01 → 02 → 04)
2. Replace in-memory inbound/outbound stubs with Sage's Relay Slack transport adapters
3. Replace `InMemorySchedulerBinding` with Relay cron substrate
4. Define Sage trait values (conversational, high-proactivity, knowledge-and-workspace vocabulary)
5. Define at least one workspace-activity follow-up rule condition
6. Walk through proof checklist in `docs/consumer/sage-adoption-path.md`

**Dependency on NightCTO:** Relay cron substrate wiring pattern validated by NightCTO. Sage should reuse the same binding approach.

**Success criteria:**
- `runtime.start()` and `runtime.stop()` complete without error
- At least one Slack message routes through a capability handler
- Proactive engine evaluates at least one follow-up rule and produces a decision
- `runtime.get('proactive')` retrieves the engine from the runtime

---

### Phase 3: MSD (next sprint after Sage)

**Goal:** Wire `03-policy-gated-assistant.ts` against MSD domain values and Relay foundation adapters. Prove the policy engine with code-review-specific rules.

**Steps:**
1. Copy the `03-policy-gated-assistant.ts` pattern into MSD product code (step through 01 → 03, add 02)
2. Replace in-memory inbound/outbound stubs with MSD's Relay surface adapters
3. Replace `InMemoryAuditSink` with MSD's code review audit sink
4. Define MSD trait values (technical, cautious, code-review vocabulary)
5. Define `msdClassifier` risk classifier in product code
6. Define at least three policy rules: `block-destructive`, `approve-pr-merge`, `approve-code-deploy`
7. Drive all four decision branches with product-specific test scenarios
8. Walk through proof checklist in `docs/consumer/msd-adoption-path.md`

**Dependency on NightCTO:** Policy engine wiring pattern validated by NightCTO. MSD should reuse the same `createActionPolicy` + `registerRule` approach.

**Success criteria:**
- `runtime.start()` and `runtime.stop()` complete without error
- At least one review message routes through the `review` capability handler
- All four policy decision branches (allow, deny, require_approval, escalate) are exercised
- Audit trail records evaluations with correct ruleId and riskLevel

---

## Cross-Consumer Dependencies

| Dependency | Direction | Impact |
|---|---|---|
| Relay adapter wiring pattern | NightCTO → Sage → MSD | Each consumer reuses the validated wiring shape |
| Relay cron substrate binding | NightCTO → Sage | Sage reuses NightCTO's scheduler binding approach |
| Proactive→policy bridge | NightCTO → (Sage v1.2) → (MSD v1.2) | Bridge pattern copy-adapted by Sage and MSD when needed |
| Audit sink interface | NightCTO → MSD | MSD adapts NightCTO's audit sink pattern to its own infrastructure |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Relay adapter interface mismatch | Medium | High — blocks all real traffic | Identify concrete Relay adapter classes before starting Phase 1; do not assume InMemoryAdapter API matches exactly |
| Watch-trigger gap in `05-full-assembly.ts` | Certain — already identified | Medium — NightCTO must implement product-side | Treat as Planned; implement product-side bridge; do not block weekend goal |
| `InMemoryAuditSink` not suitable for production | Certain | Low at v1 — acceptable for first wiring | Note in adoption docs; replace before production; does not block proof |
| Non-allow decision branches not exercised (MSD) | Certain — known review verdict finding | Medium — reduces confidence in MSD policy adoption | MSD must author its own test scenarios; do not rely on example 03's proof scenarios alone |
| `@agent-relay/memory` evaluation deferred too long | Medium | Medium — delays Sage v1.1 memory path | Sage team must schedule evaluation before v1.1 begins; do not start greenfield without it |
| NightCTO adoption reveals SDK composition bug | Low | High — blocks or delays Sage and MSD | NightCTO adopts first precisely to surface this risk early; fix in SDK before Phase 2 |

---

## What Success Looks Like After the Weekend

At the end of Phase 1 (NightCTO wired):

- One real product has `createAssistant()` called with four packages composed
- One real product has the proactive→policy bridge wired
- The proof checklist in `docs/consumer/nightcto-adoption-path.md` has every item classified as Demonstrated or Inspectable (no Planned items except watch-trigger and Relay production wiring)
- Any SDK issues discovered during wiring are filed and triaged
- Sage and MSD teams have a working reference to copy from

---

## Rollout Readiness Checklist (before starting Phase 1)

- [ ] NightCTO team has read `docs/consumer/nightcto-adoption-path.md`
- [ ] NightCTO team has read `packages/examples/src/05-full-assembly.ts`
- [ ] Concrete Relay inbound adapter class for NightCTO transport identified
- [ ] Concrete Relay outbound adapter class for NightCTO delivery identified
- [ ] Relay cron substrate binding API surface confirmed against `InMemorySchedulerBinding` contract
- [ ] Decision made on audit sink: in-memory for first wiring, or wire production sink immediately
- [ ] NightCTO domain trait values drafted
- [ ] NightCTO policy rules drafted (`block-cross-client-data`, `escalate-critical`)
- [ ] NightCTO proactive follow-up rule condition drafted (`client-status-check-in`)

V1_CONSUMER_ADOPTION_ROLLOUT_READY
