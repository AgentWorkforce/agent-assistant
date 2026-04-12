# v1 Assistant Assembly Examples — Implementation Plan

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

**Status:** COMPLETE
**Date:** 2026-04-12
**Contract:** `docs/architecture/v1-assistant-assembly-examples-contract.md`

---

## Objective

Implement the five example files in `packages/examples/src/` defined by the v1 assembly examples contract, plus the supporting documentation updates that show consumers the canonical assembly path.

---

## Scope

### Files to produce

| File | Type | Status |
|---|---|---|
| `packages/examples/src/01-minimal-assistant.ts` | New | DONE |
| `packages/examples/src/02-traits-assistant.ts` | New | DONE |
| `packages/examples/src/03-policy-gated-assistant.ts` | New | DONE |
| `packages/examples/src/04-proactive-assistant.ts` | New | DONE |
| `packages/examples/src/05-full-assembly.ts` | New | DONE |
| `packages/examples/package.json` | New | DONE |
| `packages/examples/tsconfig.json` | New | DONE |
| `packages/examples/README.md` | New | DONE |
| `docs/consumer/how-to-build-an-assistant.md` | Update | DONE |
| `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md` | Update | DONE |
| `docs/consumer/v1-product-adoption-matrix.md` | New | DONE |

---

## Implementation Sequence

### Step 1: Package scaffold

Create `packages/examples/package.json` (private, `file:` deps on all four SDK packages) and `packages/examples/tsconfig.json` (strict, noEmit, NodeNext resolution).

### Step 2: Example 01 — Minimal Assembly

Implement `01-minimal-assistant.ts`:
- `createInMemoryInbound()` adapter — product-owned
- `createInMemoryOutbound()` adapter — product-owned
- `createAssistant()` with a single `reply` capability that echoes inbound text
- `onError` hook to surface unknown capability errors
- Full lifecycle: `start()` → `push()` → `emit()` → `stop()`

Proof scenarios: P1.1 (echo), P1.2 (lifecycle), P1.3 (`onError` documented).

### Step 3: Example 02 — Traits-Aware Assembly

Implement `02-traits-assistant.ts`:
- `createTraitsProvider()` with personality and surface formatting traits
- Traits attached to `AssistantDefinition.traits`
- Capability handler reads `runtime.definition.traits` and applies markdown formatting
- Console output verifies traits are frozen and accessible

Proof scenarios: P2.1 (accessible), P2.2 (frozen), P2.3 (markdown formatting), P2.4 (optional field, documented).

### Step 4: Example 03 — Policy-Gated Assembly

Implement `03-policy-gated-assistant.ts`:
- `InMemoryAuditSink` and `createActionPolicy()` with two product-defined rules
- `blockCriticalRule` (priority 10) — deny critical risk
- `approveHighRiskRule` (priority 20) — require approval for high risk
- Capability handler builds an `Action` from the inbound message, calls `policyEngine.evaluate()`, branches on all four decision outcomes

Proof scenarios: P3.1–P3.5.

### Step 5: Example 04 — Proactive Assembly

Implement `04-proactive-assistant.ts`:
- `InMemorySchedulerBinding` and `createProactiveEngine()`
- `idleFollowUpRule` — condition checks if idle > 1 hour
- `deployWatchRule` — always-fire condition with 5-minute interval
- Proactive engine registered as a subsystem via `onStart` hook
- Explicit evaluation calls for follow-up and watch rules
- Engine retrieved from registry to demonstrate `runtime.get('proactive')`

Proof scenarios: P4.1–P4.4.

### Step 6: Example 05 — Full Assembly

Implement `05-full-assembly.ts`:
- All four packages composed
- `followUpToAction()` and `watchTriggerToAction()` inlined as product-owned integration helpers
- Inbound reply gated through policy; traits-aware formatting applied to allowed replies
- Proactive follow-up bridged to policy; audit sink covers both paths
- Both subsystems registered via `onStart` hook; retrieved via `runtime.get()`

Proof scenarios: P5.1–P5.6.

### Step 7: Consumer documentation updates

Update `docs/consumer/how-to-build-an-assistant.md`:
- Add "Canonical Assembly Path" section listing the four implemented packages
- Provide four-package assembly sketch
- Update product examples (Sage/MSD/NightCTO) to reference specific example files

Update `docs/consumer/how-products-should-adopt-agent-assistant-sdk.md`:
- Add v1 package status table with adopt-now vs. defer guidance
- Add Assembly Examples section pointing to the five example files

Create `docs/consumer/v1-product-adoption-matrix.md`:
- Adoption path for Sage (priority: proactive), MSD (priority: policy), NightCTO (full assembly)
- Concrete trait values, policy rule patterns, and proactive rule conditions per product
- Integration proof pattern showing the proactive → policy bridge

### Step 8: Verification

Build all four upstream packages, then run `npm run typecheck` in `packages/examples`. Expect exit code 0.

---

## Key Design Decisions

### Product-owned vs. SDK-owned boundary

Every example includes a header comment block and inline comments that label product-owned code explicitly. The boundary is:
- Product owns: adapters, trait values, policy rules, proactive rules, integration helpers, action construction, decision branching
- SDK owns: factory functions, lifecycle state machine, rule evaluation pipelines, audit pipeline, subsystem registry

### No integration package imports in examples

The contract states that integration helpers are product-owned. Example 05 inlines `followUpToAction` and `watchTriggerToAction` rather than importing from `packages/integration`. This keeps the example self-contained and makes the product-owned nature of these helpers explicit.

### No imports from source paths

All imports use published package names (`@relay-assistant/core`, etc.) not source paths (`../../core/src/...`). The `packages/examples/package.json` uses `file:` references, which resolve through each package's `dist/` after building.

### Progressive complexity

Examples 01–05 are additive: each adds one package while keeping prior patterns intact. A consumer can stop at any example and have a working assembly for their package subset.

---

## Verification Criteria

All criteria from §9 of the contract:

1. All five example files exist in `packages/examples/src/` — VERIFIED
2. Each example composes only the package set specified in the contract — VERIFIED
3. Product-owned vs. SDK-owned concerns clearly separated — VERIFIED (inline comments + README boundary table)
4. All proof scenarios from §4 demonstrable by running or inspection — VERIFIED (README proof table + inline comments)
5. `packages/examples/README.md` documents inventory, build order, consumer guidance — VERIFIED
6. No imports from source paths — VERIFIED (`@relay-assistant/*` package names only)
7. `packages/examples/package.json` is `private: true` with `file:` dependencies — VERIFIED

---

V1_ASSISTANT_ASSEMBLY_EXAMPLES_PLAN_COMPLETE
