# Current State

Date: 2026-04-22

Authoritative snapshot of package implementation status, local test results, and the most important remaining gaps. This document is a status record, not a design doc — see [docs/index.md](index.md) for navigation and [docs/specs/](specs/) for canonical contracts.

Current architecture framing reminder: `@agent-assistant/harness` is the bounded turn executor, not the umbrella runtime concept. The turn-scoped assembly seam now lives in the implemented `@agent-assistant/turn-context` primitive, while `@agent-assistant/traits` remains the stable identity floor and product intelligence remains product-owned.

---

## Test Results (2026-04-22)

Run: `npx vitest run`

| Package area | Test file(s) | Tests | Result |
| --- | --- | --- | --- |
| `@agent-assistant/core` | `core.test.ts`, `core-traits.test.ts`, `core-sessions.test.ts`, `core-sessions-surfaces.test.ts` | 16 + 9 + 9 + 6 | **PASS** |
| `@agent-assistant/sessions` | `sessions.test.ts` | 25 | **PASS** |
| `@agent-assistant/surfaces` | `surfaces.test.ts`, `slack-thread-gate.test.ts`, `slack-event-dedup.test.ts`, `slack-ingress.test.ts` | 28 + 11 + 9 + 4 | **PASS** |
| `@agent-assistant/routing` | `routing.test.ts` | 52 | **PASS** |
| `@agent-assistant/traits` | `traits.test.ts` | 32 | **PASS** |
| `@agent-assistant/proactive` | `proactive.test.ts` | 53 | **PASS** |
| `@agent-assistant/policy` | `policy.test.ts` | 64 | **PASS** |
| `@agent-assistant/harness` | `harness.test.ts`, `claude-code-adapter.test.ts`, `byoh-local-proof.test.ts` | 14 + 9 + 9 | **PASS** |
| `@agent-assistant/connectivity` | `connectivity.test.ts` | 30 | **PASS** |
| `@agent-assistant/coordination` | `coordination.test.ts` | 39 | **PASS** |
| `@agent-assistant/memory` | `memory.test.ts` | 53 | **PASS** |
| `@agent-assistant/turn-context` | `assembler.test.ts` | 5 | **PASS** |
| `@agent-assistant/continuation` | `continuation.test.ts` | 49 | **PASS** |
| `@agent-assistant/inbox` | `inbox.test.ts`, `memory-projector.test.ts`, `enrichment-projector.test.ts` | 15 + 13 + 11 | **PASS** |
| `@agent-assistant/integration-tests` | `integration.test.ts` | 14 | **PASS** |

**Total verified passing: 579 tests across 24 test files**

---

## Package Implementation Status

| Package | Status | Notes |
| --- | --- | --- |
| `@agent-assistant/core` | **IMPLEMENTED** | Stable runtime shell |
| `@agent-assistant/sessions` | **IMPLEMENTED** | Stable continuity primitive |
| `@agent-assistant/surfaces` | **IMPLEMENTED** | Includes Slack thread gate and event dedup coverage |
| `@agent-assistant/routing` | **IMPLEMENTED** | Routing hardening landed |
| `@agent-assistant/connectivity` | **IMPLEMENTED** | Package-local publishability cleanup landed |
| `@agent-assistant/coordination` | **IMPLEMENTED** | Coordination package currently green locally |
| `@agent-assistant/traits` | **IMPLEMENTED** | Stable assistant identity floor |
| `@agent-assistant/harness` | **IMPLEMENTED** | Bounded turn executor |
| `@agent-assistant/turn-context` | **IMPLEMENTED** | Turn-scoped context assembly is now real, not just specified |
| `@agent-assistant/memory` | **IMPLEMENTED** | Depends on `@agent-relay/memory`; package and tests are currently green in local repo state |
| `@agent-assistant/continuation` | **IMPLEMENTED** | Resumable unfinished turn lineage primitive |
| `@agent-assistant/inbox` | **IMPLEMENTED** | Trusted outsider ingestion boundary |
| `@agent-assistant/proactive` | **IMPLEMENTED** | Stable proactive baseline |
| `@agent-assistant/policy` | **IMPLEMENTED** | Stable approval / governance seam |
| `@agent-assistant/sdk` | **IMPLEMENTED** | Top-level facade package |
| `@agent-assistant/integration-tests` | **IMPLEMENTED** | Private integration package for cross-package coverage |
| `@agent-assistant/examples` | reference package | Reference adoption examples |

---

## What Changed Since Older Status Snapshots

Older status docs in this repo may still imply some combination of the following:

- memory is placeholder-only
- turn-context is specified but not implemented
- coordination is blocked in practice
- test counts are much lower than current reality

Those statements are no longer accurate for the current local repo state verified on 2026-04-22.

---

## Real Remaining Gaps

### 1. Documentation and status drift
The code has moved ahead of several index/status docs. The repo needs ongoing consolidation so public readers get the current truth, not historical intermediate states.

### 2. Publish/install truth still matters
A green local monorepo is not the same as a healthy external consumer experience. Public package installability, tarball contents, dependency correctness, and clean npm-only smoke validation should remain first-class gates.

### 3. Product-proof slices still matter
Package-local tests are strong, but the SDK still benefits from real proving in consumer products such as Sage and NightCTO, especially around:

- turn-context composition in real product flows
- continuation behavior across real surfaces
- BYOH / execution-adapter behavior in product environments
- inbox / outsider-ingestion semantics

---

## V1 Baseline (usable building blocks)

These package areas are actively implemented and locally green:

- core
- sessions
- surfaces
- routing
- connectivity
- coordination
- traits
- harness
- turn-context
- memory
- continuation
- inbox
- proactive
- policy
- sdk facade

This baseline should still be read as a stack of adjacent primitives, not as “the harness plus extras.” In particular, products should keep turn-shaping and product intelligence out of harness-owned code paths.

---

## Recommended Near-Term Priorities

1. **Docs reconciliation** — keep README, docs index, and status pages aligned with actual code reality.
2. **Publish/readiness verification** — verify public package installation and runtime behavior from clean environments.
3. **Product proof** — continue bounded proving in Sage / NightCTO / BYOH-backed real flows.

---

CURRENT_STATE_READY
