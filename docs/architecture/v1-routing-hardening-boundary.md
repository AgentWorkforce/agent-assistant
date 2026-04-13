# v1 Routing Hardening Boundary

**Date:** 2026-04-13
**Package:** `@agent-assistant/routing`
**Purpose:** Define the bounded hardening slice required to close the explicit routing DoD gap around test coverage and local validation, without expanding scope into broader connectivity, coordination, memory, or product behavior.

---

## 1. Why this boundary exists

Routing was already implemented and reviewed as architecturally sound, but it remained held back for one explicit reason: the package had only 12 tests against a stated 40+ minimum, plus one known correctness bug in the `escalated` flag when `modeCeiling` hard-capped a non-escalated candidate.

This hardening slice exists to answer one honest question:

> Is `@agent-assistant/routing` ready to move from “implemented but held back” to a publishable wave-2 package **based on its own bounded contract**?

This document defines what must be covered now, what the pre-hardening gaps were, and what remains intentionally deferred.

---

## 2. In-scope now: behaviors that must be covered

The package must now have direct tests for the bounded v1 routing contract it already claims to implement.

### A. Core decision defaults
- Default mode selection with no policy overrides (`fast`)
- Default reason (`policy_default`)
- Default `escalated === false`
- Default `overridden === false`
- Non-default policy defaults (`cheap`, `deep`)

### B. Priority-chain behavior
- Caller override beats capability override
- Capability override beats escalation and default
- Cost envelope beats escalation
- Escalation beats latency/default
- Hard ceiling is applied as a post-filter over any selected candidate

### C. Caller override and hard constraints
- Caller-requested mode is respected when allowed
- Caller-requested mode is capped when ceiling forbids it
- Hard-capped caller requests set `reason: 'hard_constraint'`
- Hard-capped caller requests set `overridden: true`
- Hard-capped caller requests do **not** falsely set `escalated: true`

### D. Capability override behavior
- Matching capability override selects the configured mode
- Capability override sets the correct reason
- Non-matching capabilities fall back to the normal chain

### E. Cost-envelope behavior
- Exceeding the envelope downgrades to `cheap`
- The downgrade reason is `cost_envelope_exceeded`
- Cost exactly at the limit does not trip
- `costEnvelopeLimit: 0` behaves as “no limit”

### F. Escalation-selection behavior
- Active escalations map to configured modes
- Escalation-driven decisions set `escalated: true`
- Escalation-driven decisions use `reason: 'escalation_signal'`
- Higher-priority mapped escalation wins over lower-priority deeper options
- Same-priority mapped escalations use the deeper mode as tiebreaker
- Unmapped escalation entries are ignored

### G. Latency behavior
- Latency routing is only considered when `requestedMaxLatencyMs` is present
- When `deep` cannot meet latency but `fast` can, routing selects `fast`
- When neither `deep` nor `fast` can meet latency, routing selects `cheap`
- Latency-driven decisions use `reason: 'latency_constraint'`

### H. Mode ceiling behavior
- Ceiling can cap escalation-selected mode
- Ceiling can cap policy-default mode
- `modeCeiling: 'deep'` is a no-op ceiling
- Hard-capped decisions preserve whether the original candidate was escalation-driven

### I. ModelSpec construction
- Default mode specs are returned correctly
- Policy mode spec overrides merge correctly
- Context requirements raise capability flags (`requiresToolUse`, `requiresStreaming`)
- Context `minContextTokens` raises the minimum as needed
- `requestedMaxLatencyMs` propagates into the returned `ModelSpec`
- `hints` merge without discarding unrelated defaults

### J. Cost bookkeeping helpers
- Unknown threads read as `0`
- Cost accumulates per thread
- Reset clears a thread
- Thread cost is isolated across threads
- Invalid `recordCost()` calls reject bad input

### K. Connectivity-facing escalation hook
- `onEscalation()` returns mapped modes for supported escalation classes
- `onEscalation()` applies the mode ceiling
- `onEscalation()` ignores unmapped escalation classes
- `onEscalation()` ignores non-escalation classes

### L. Bounded local validation
At minimum for this slice:
- `packages/routing` tests pass
- `packages/routing` typecheck passes
- `packages/routing` build passes

---

## 3. Pre-hardening gaps

Before this slice, the explicit gaps were:

1. **DoD failure:** test count was 12, below the 40+ target.
2. **Coverage shape gap:** existing tests proved the happy-path implementation existed, but did not lock the package boundary with enough granularity around edge cases and precedence.
3. **Known correctness bug:** `hard_constraint` incorrectly forced `escalated: true` even when the original candidate was not escalation-driven.
4. **Validation gap:** the package needed an updated, explicit review verdict tied to the new coverage and strongest local validation.

---

## 4. What is explicitly deferred

These are **not** part of this hardening slice and must not be used to quietly expand the task:

### A. Coordination / connectivity pipeline work
- Making coordination pass `activeEscalations` into `router.decide()`
- Making the push-style `onEscalation()` path persist pending escalation state inside the router
- Redesigning the coordination↔routing↔connectivity integration path

### B. Cross-package dependency cleanup
- Reworking connectivity’s package-level type re-export posture
- Broad publish-graph or workspace dependency redesign
- Fixing unrelated dist/publish issues outside routing itself

### C. Non-routing product behavior
- Product-specific routing policy rules
- Provider/model ID resolution
- Workforce persona wiring
- Memory-aware or session-aware routing
- Coordination-aware dynamic rerouting beyond the current routing package contract

### D. Nice-to-have but non-blocking routing improvements
- `tsconfig` conformance tidy-up (`declarationMap`, `sourceMap`, test exclusion)
- Richer explain/debug traces
- Dynamic policy reloads
- Provider failover logic

---

## 5. Exit criteria for this slice

This hardening slice is complete when all of the following are true:

- The routing suite reaches or exceeds the stated 40+ threshold
- The new tests cover the bounded contract above rather than inflating count with trivial construction checks
- The known `escalated` bug is either disproven or fixed
- Local test, typecheck, and build validation pass
- A review verdict states plainly whether routing is now `READY_FOR_WAVE_2` or `STILL_HELD_BACK`

---

## 6. Decision rule

- If test count clears the threshold, the coverage shape is materially stronger, the known correctness bug is fixed, and local validation passes, the honest verdict is **`READY_FOR_WAVE_2`**.
- If any of those fail, or if new tests expose broader unresolved correctness issues inside the routing package itself, the honest verdict is **`STILL_HELD_BACK`**.

V1_ROUTING_HARDENING_BOUNDARY_READY
