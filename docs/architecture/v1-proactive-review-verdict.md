# v1 Proactive Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-12
**Reviewed artifacts:**
- `docs/architecture/v1-proactive-scope.md`
- `docs/specs/v1-proactive-spec.md`
- `docs/architecture/v1-proactive-implementation-plan.md`
- `packages/proactive/README.md`
- `docs/research/proactive-runtime-notes.md`

## Summary

The v1 proactive package is broadly well-bounded and realistic. The docs consistently position it as a decision-layer package with no runtime lifecycle, no relaycron implementation, no direct memory/session/routing/surfaces dependency, and no coordination ownership in v1. That is a sensible v1 cut.

The main issue is not scope size. It is contract consistency. Several core behaviors are described differently across the scope doc, spec, implementation plan, README, and runtime notes. Because of that, this is close to implementation-ready, but not strong enough to drive the next workflow without a short doc-alignment pass first.

## Assessment

### 1. Is the v1 proactive scope bounded and realistic?

Yes.

Reasons:
- The package boundary is tight: decision engine, rule registration/evaluation, reminder state, scheduler interface, in-memory test adapter, and error types only. That boundary is stated consistently in the scope and spec docs (`docs/architecture/v1-proactive-scope.md:15-24`, `docs/specs/v1-proactive-spec.md:16-29`).
- Major complexity is explicitly deferred: real relaycron binding, persistence, cross-session scope, distributed execution, coordination-driven behavior, and policy budgets (`docs/architecture/v1-proactive-scope.md:108-121`, `docs/specs/v1-proactive-spec.md:438-449`).
- The implementation plan is modest in size and self-contained for a single PR (`docs/architecture/v1-proactive-implementation-plan.md:40-65`).

Constraint to keep in mind:
- Watch rules plus in-memory-only state are realistic only for static rule sets or process-local use. The docs do acknowledge that restart persistence is deferred (`docs/research/proactive-runtime-notes.md:217-225`).

### 2. Is the relationship to relaycron clear enough?

Mostly yes, with one important follow-up.

What is clear:
- relaycron owns scheduling and dispatch; proactive owns the decision of when and why to schedule (`docs/architecture/v1-proactive-scope.md:43-82`).
- The package integrates only through `SchedulerBinding`, and products own the real binding (`docs/specs/v1-proactive-spec.md:54-90`).
- Wake-ups arrive through a synthetic inbound message into a product-owned `proactive` capability handler (`docs/research/proactive-runtime-notes.md:19-31`).

What is still unclear enough to slow implementation:
- Initial scheduling ownership is underspecified. Some passages imply the engine “handles scheduling,” while others say products schedule the initial wake-up and resumed wake-ups themselves. The most visible contradiction is `packages/proactive/README.md:119`, which says “The engine handles scheduling,” versus `docs/specs/v1-proactive-spec.md:357` and `docs/research/proactive-runtime-notes.md:94-96`, which put initial or resume scheduling in product code.

Conclusion:
- The relaycron layering itself is clear.
- The scheduling responsibility split for initial follow-up/watch registration and watch resume needs one explicit normative statement.

### 3. Are the package boundaries with memory/coordination/routing/surfaces clear?

Mostly yes.

What is clear:
- Memory is optional and interface-based, not a package dependency (`docs/architecture/v1-proactive-scope.md:127-155`).
- Coordination is explicitly out of scope for v1 (`docs/architecture/v1-proactive-scope.md:176-182`).
- Routing is reduced to a plain-string hint with no dependency on routing internals (`docs/architecture/v1-proactive-scope.md:184-201`).
- Surfaces are downstream of the normal runtime emit path, not part of proactive itself (`docs/architecture/v1-proactive-scope.md:203-225`).

What weakens the boundary clarity:
- The scope doc says the engine may trigger memory promotion on session end (`docs/architecture/v1-proactive-scope.md:155`), but the rest of the docs do not define any session-end detection API in v1. That sentence overreaches the otherwise clean boundary.
- The runtime notes attribute “reminder count ceiling” extraction to the MSD watch-rule pattern (`docs/research/proactive-runtime-notes.md:197-200`), but the actual watch-rule types do not define reminder-count state or watch-specific suppression. That blurs whether reminder ceilings are follow-up-only or shared with watch rules.

Conclusion:
- The package boundaries are conceptually clear.
- A few stray statements should be tightened so the boundary contract is fully enforceable.

### 4. Is this strong enough to directly drive the next implementation workflow?

Not yet. It is close, but a short cleanup pass is needed first.

## Required Follow-Ups Before Implementation

1. Resolve the `defer` contradiction.
`defer` appears in the ownership list and `FollowUpDecision.action` union (`docs/specs/v1-proactive-spec.md:21`, `docs/specs/v1-proactive-spec.md:152-180`), but the implementation plan and deferred notes say v1 returns only `fire | suppress` (`docs/architecture/v1-proactive-implementation-plan.md:36`, `docs/research/proactive-runtime-notes.md:252-256`). Pick one v1 contract and apply it everywhere. The current docs point to “no `defer` in v1.”

2. Resolve `suppressWhenActive` semantics.
The suppression logic says `lastActivityAt > scheduledAt` (`docs/specs/v1-proactive-spec.md:174`, `docs/architecture/v1-proactive-implementation-plan.md:297-300`, `docs/research/proactive-runtime-notes.md:48-62`), but the reminder policy text defines “active” as “within the last 5 minutes relative to scheduledAt” (`docs/specs/v1-proactive-spec.md:197-200`). Those are different rules. Keep one definition.

3. Resolve evidence-fetch behavior.
The spec says the engine fetches evidence before calling each rule condition (`docs/specs/v1-proactive-spec.md:382-390`), while the implementation plan, README, and runtime notes say one fetch per `evaluateFollowUp()` call shared across rules (`docs/architecture/v1-proactive-implementation-plan.md:308-313`, `packages/proactive/README.md:220`, `docs/research/proactive-runtime-notes.md:167-175`). The batched-per-evaluation approach is better and should become the single contract.

4. Normalize follow-up rule API names.
The spec says reminder state resets when `engine.cancelFollowUpRule(ruleId)` is called (`docs/specs/v1-proactive-spec.md:216-218`), but the public API everywhere else uses `removeFollowUpRule(ruleId)` (`docs/specs/v1-proactive-spec.md:289-293`, `docs/architecture/v1-proactive-implementation-plan.md:208-212`). There should be one method name.

5. Normalize watch lifecycle and rescheduling responsibility.
The scope doc lists watch lifecycle as `pause`, `cancel`, `list` (`docs/architecture/v1-proactive-scope.md:97`), while the spec/plan include `resumeWatchRule()` too (`docs/specs/v1-proactive-spec.md:296-301`, `docs/architecture/v1-proactive-implementation-plan.md:215-220`). Also define exactly who schedules:
- the first wake-up after `registerWatchRule`
- the next wake-up after `resumeWatchRule`
- any initial follow-up wake-up

6. Clarify watch evaluation granularity.
`evaluateWatchRules(context)` iterates all active rules (`docs/architecture/v1-proactive-implementation-plan.md:339-365`), even though wake-up payloads carry a specific `ruleId` (`docs/specs/v1-proactive-spec.md:69-74`, `docs/specs/v1-proactive-spec.md:318-323`). That may be intentional, but it is inefficient and surprising. The docs need to say whether wake-ups are:
- per rule, evaluating only that rule, or
- a generic periodic tick that evaluates all active rules

7. Remove or define unsupported v1 claims.
- “The proactive engine detects session end” is not backed by an API and should be removed or deferred (`docs/architecture/v1-proactive-scope.md:155`).
- README wording that “the engine handles scheduling” should be narrowed to “watch-rule rescheduling via `SchedulerBinding`” or similar (`packages/proactive/README.md:119`).

## Bottom Line

The v1 scope is bounded and realistic. The relaycron relationship and package boundaries are mostly sound. The remaining work is not architectural rethinking; it is a contract cleanup pass across the five docs so implementation is driven by one unambiguous source of truth.

Artifact produced:
- `docs/architecture/v1-proactive-review-verdict.md`

V1_PROACTIVE_REVIEW_COMPLETE
