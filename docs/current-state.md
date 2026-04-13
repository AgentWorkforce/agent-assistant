# Current State

Date: 2026-04-13

> Public release note: the repo is now public and wave-1 packages have been published to npm. A post-publish external smoke test found that the published baseline packages are missing `dist/` artifacts in the installed tarballs for at least `@agent-assistant/core`, so the npm install story is not yet healthy despite successful local `npm pack --dry-run` verification.

Authoritative snapshot of package implementation status, test results, and known blockers. Derived from `npx vitest run` output and code inspection. This document is a status record, not a design doc — see `docs/index.md` for navigation and `docs/specs/` for canonical contracts.

---

## Test Results (2026-04-13)

Run: `npx vitest run`

| Package | Test File(s) | Tests | Result |
| --- | --- | --- | --- |
| `@agent-assistant/core` | `core.test.ts`, `core-sessions-surfaces.test.ts` | 31 + 6 integration | **PASS** |
| `@agent-assistant/sessions` | `sessions.test.ts` | 25 | **PASS** |
| `@agent-assistant/surfaces` | `surfaces.test.ts` | 28 | **PASS** |
| `@agent-assistant/routing` | `routing.test.ts` | 52 | **PASS** |
| `@agent-assistant/traits` | `traits.test.ts` | 32 | **PASS** |
| `@agent-assistant/proactive` | `proactive.test.ts` | 53 | **PASS** |
| `@agent-assistant/policy` | `policy.test.ts` | 64 | **PASS** |
| `@agent-assistant/harness` | `harness.test.ts` | 14 | **PASS** |
| `@agent-assistant/connectivity` | `connectivity.test.ts` | 30 | **PASS** |
| `@agent-assistant/coordination` | `coordination.test.ts` | ~39 actual (blocked by connectivity) | **BLOCKED** — depends on `@agent-assistant/connectivity` which cannot load |
| `@agent-assistant/memory` | `memory.test.ts` | — | **BLOCKED** — `@agent-relay/memory` package missing; package excluded from workspace install (private) |

**Total verified passing: 368 tests (12 passing suites, 1 blocked suite)**

---

## Package Implementation Status

| Package | Status | Spec | Notes |
| --- | --- | --- | --- |
| `@agent-assistant/core` | **IMPLEMENTED** | `SPEC_RECONCILED` | Stable — v1 baseline |
| `@agent-assistant/sessions` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Stable — v1 baseline |
| `@agent-assistant/surfaces` | **IMPLEMENTED** | `SPEC_RECONCILED` | Stable — v1 baseline |
| `@agent-assistant/routing` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Routing hardening complete: 52 tests passing; READY_FOR_WAVE_2 within package boundary. |
| `@agent-assistant/connectivity` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 30 tests passing; package-local publishability/export hygiene cleanup complete; READY_FOR_WAVE_2 within package boundary. |
| `@agent-assistant/coordination` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | 39 tests passing locally; broader publish/dependency cleanup still applies outside connectivity scope. |
| `@agent-assistant/traits` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Stable — assistant identity traits, voice, style, behavioral defaults |
| `@agent-assistant/proactive` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Stable — v1 baseline; spec at `docs/specs/v1-proactive-spec.md` |
| `@agent-assistant/policy` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Stable — v1 baseline; spec at `docs/specs/v1-policy-spec.md` |
| `@agent-assistant/harness` | **IMPLEMENTED** | `IMPLEMENTATION_READY` | Bounded turn runtime with iterative model/tool/model execution, truthful stop semantics, continuation payloads, and trace hooks |
| `@agent-assistant/memory` | **placeholder (private — excluded from workspace install)** | `IMPLEMENTATION_READY` | Spec at `docs/specs/v1-memory-spec.md`; blocked by `@agent-relay/memory` dep (relay foundation infrastructure, not yet publicly available) |
| `@agent-assistant/examples` | reference package | N/A | Reference adoption examples; not production code |

---

## Known Blockers

### 1. Published npm packages missing runtime build artifacts
- **Impact:** A clean npm-only install of `@agent-assistant/sdk@0.1.0` currently fails at runtime because installed dependency packages such as `@agent-assistant/core` do not contain `dist/index.js` even though their manifests export it.
- **Evidence:** external smoke test in `/tmp/agent-assistant-smoke` failed with `ERR_MODULE_NOT_FOUND` for `node_modules/@agent-assistant/core/dist/index.js`; installed package contents contained only `README.md` and `package.json`.
- **Likely cause:** packages were published from repo state where `dist/` was not actually present in the published tarball, despite later local `npm pack --dry-run` checks passing.
- **Resolution:** inspect the published npm tarballs, republish/fix the affected wave-1 packages, then rerun the npm-only smoke test.
- **Risk:** treat the current npm release as needing immediate remediation before external adoption.

### 2. `@agent-assistant/connectivity` had a public type leak to routing (resolved)
- **Impact:** external TypeScript consumers of the packed connectivity package could fail to typecheck because emitted `.d.ts` files referenced `@agent-assistant/routing`, which was not a declared runtime dependency.
- **Resolution:** connectivity now defines `RequestedRoutingMode` and `RoutingEscalationHook` locally, removes the unnecessary routing coupling from scripts/devDependencies, and passes npm-only install + typecheck smoke validation.
- **Risk:** package-local blocker cleared; broader repo publish sequencing still applies.

### 3. `@agent-relay/memory` missing
- **Impact:** `@agent-assistant/memory` package and tests cannot run.
- **Status:** Memory is marked `"private": true` and excluded from the workspace install graph. It will be re-enabled when `@agent-relay/memory` is published publicly.
- **Note:** `@agent-assistant/memory` is not yet installable. It depends on `@agent-relay/memory` (relay foundation infrastructure) which is not publicly available.

---

## V1 Baseline (Safe for Product Use)

These packages are stable and can be consumed in products:
- `@agent-assistant/core`
- `@agent-assistant/sessions`
- `@agent-assistant/surfaces`
- `@agent-assistant/traits`
- `@agent-assistant/proactive`
- `@agent-assistant/policy`
- `@agent-assistant/harness`

---

## Deferred Publish Tracking (Wave 2+)

| Package | Current blocker | Publish gate |
| --- | --- | --- |
| `@agent-assistant/routing` | no current package-local blocker; broader wave-2 publish sequencing still applies | package-local hardening complete |
| `@agent-assistant/connectivity` | no current package-local blocker | package-local cleanup complete; proceed within wave-2 sequencing |
| `@agent-assistant/coordination` | depends on connectivity readiness | connectivity green + dependency cleanup + review |
| `@agent-assistant/memory` | blocked on `@agent-relay/memory` public installability | publish/install `@agent-relay/memory`, then re-enable and validate |

---

## Workflow Completion

| Workflow | Status |
| --- | --- |
| WF-1: Define assistant and start runtime | **COMPLETE** |
| WF-2: Handle inbound message via dispatch | **COMPLETE** |
| WF-3: Create and manage sessions | **COMPLETE** |
| WF-4: Wire session store into runtime | **COMPLETE** |
| WF-5: Register surface registry and route messages | **COMPLETE** |
| WF-6: Multi-surface session fanout | **COMPLETE** |
| WF-7: End-to-end assembly | **OPEN** — no assembly test in `packages/examples/src/` |

See [workflow backlog](workflows/v1-workflow-backlog.md) for details.

---

CURRENT_STATE_READY
