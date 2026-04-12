# Publish Package Readiness Matrix — RelayAssistant

> Authoritative publish-now vs defer decision matrix for all `@relay-assistant/*` packages.
> Derived from the publish infrastructure contract, current package state, and per-package test status.
> Date: 2026-04-12

---

## Decision Summary

| Decision | Packages |
|----------|----------|
| **PUBLISH NOW** (v0.1.0 baseline) | `traits`, `core`, `sessions`, `surfaces` |
| **DEFERRED — v1 (blocker active)** | `routing`, `connectivity`, `coordination` |
| **DEFERRED — v1.1** | `memory` |
| **DEFERRED — v1.2** | `proactive` |
| **DEFERRED — v2** | `policy` |
| **NEVER PUBLISH** | `examples`, `integration-tests` |

---

## Publish-Now Packages (v0.1.0)

These four packages satisfy all publish gates and MUST be published as the v0.1.0 initial release.

### Evaluation Gates

| Gate | Description | Pass Criteria |
|------|-------------|---------------|
| G1 | `vitest run` exits 0 | All declared tests pass |
| G2 | `tsc -p tsconfig.json` exits 0 | Build succeeds |
| G3 | No `file:` references to missing packages | All `file:` deps resolve to packages that exist |
| G4 | `private` field absent or `false` | Package is publishable |
| G5 | `publishConfig.access: "public"` set | **MISSING — must add before publish** |
| G6 | `repository.url` declared | **MISSING — must add before publish** |

---

### `@relay-assistant/traits`

| Field | Value |
|-------|-------|
| Path | `packages/traits` |
| npm name | `@relay-assistant/traits` |
| Version | `0.1.0` |
| Tests | 32 / 30 minimum |
| Build deps | None (no internal deps) |
| External deps | None in `dependencies` |
| file: references | None |
| private | false (field absent) |
| publishConfig | **MISSING** |
| repository.url | **MISSING** |
| **Verdict** | **PUBLISH NOW** — publish first (no dependents, depended upon by core) |

**Pre-publish actions required:**
- Add `"publishConfig": { "access": "public" }` to `package.json`
- Add `"repository": { "type": "git", "url": "https://github.com/<org>/relay-agent-assistant" }` to `package.json`

---

### `@relay-assistant/core`

| Field | Value |
|-------|-------|
| Path | `packages/core` |
| npm name | `@relay-assistant/core` |
| Version | `0.1.0` |
| Tests | 31 / 30 minimum |
| Build deps | `@relay-assistant/traits` (peerDependency `>=0.1.0`) |
| External deps | None in `dependencies` |
| file: references | `devDependencies` only: `@relay-assistant/traits: file:../traits` — acceptable (dev-only) |
| private | false (field absent) |
| publishConfig | **MISSING** |
| repository.url | **MISSING** |
| **Verdict** | **PUBLISH NOW** — publish after traits |

**Pre-publish actions required:**
- Add `"publishConfig": { "access": "public" }` to `package.json`
- Add `"repository": { "type": "git", "url": "https://github.com/<org>/relay-agent-assistant" }` to `package.json`
- Confirm `peerDependency` on `@relay-assistant/traits` references registry version (`>=0.1.0`) — already correct

---

### `@relay-assistant/sessions`

| Field | Value |
|-------|-------|
| Path | `packages/sessions` |
| npm name | `@relay-assistant/sessions` |
| Version | `0.1.0` |
| Tests | 25 / 20 minimum |
| Build deps | None |
| External deps | None in `dependencies` |
| file: references | None |
| private | false (field absent) |
| publishConfig | **MISSING** |
| repository.url | **MISSING** |
| **Verdict** | **PUBLISH NOW** — no blocking constraints |

**Pre-publish actions required:**
- Add `"publishConfig": { "access": "public" }` to `package.json`
- Add `"repository": { "type": "git", "url": "https://github.com/<org>/relay-agent-assistant" }` to `package.json`

---

### `@relay-assistant/surfaces`

| Field | Value |
|-------|-------|
| Path | `packages/surfaces` |
| npm name | `@relay-assistant/surfaces` |
| Version | `0.1.0` |
| Tests | 28 / 25 minimum |
| Build deps | None |
| External deps | None in `dependencies` |
| file: references | None |
| private | false (field absent) |
| publishConfig | **MISSING** |
| repository.url | **MISSING** |
| **Verdict** | **PUBLISH NOW** — no blocking constraints |

**Pre-publish actions required:**
- Add `"publishConfig": { "access": "public" }` to `package.json`
- Add `"repository": { "type": "git", "url": "https://github.com/<org>/relay-agent-assistant" }` to `package.json`

---

## Deferred Packages

### `@relay-assistant/routing` — DEFERRED v1

| Field | Value |
|-------|-------|
| Path | `packages/routing` |
| npm name | `@relay-assistant/routing` |
| Version | `0.1.0` |
| Tests | ~12 of 40+ required (DoD gap) |
| Build deps | None |
| External deps | None |
| **Blocker** | **DOD-GAP-001:** Test count 12/40+; does not meet minimum. Gate G1 fails. |
| Earliest milestone | v1 (after test gap closed) |
| **Verdict** | **DEFER** — must not publish until 40+ tests pass |

**Unblock path:** Write sufficient tests to reach 40+ passing; re-evaluate G1.

---

### `@relay-assistant/connectivity` — DEFERRED v1

| Field | Value |
|-------|-------|
| Path | `packages/connectivity` |
| npm name | `@relay-assistant/connectivity` |
| Version | `0.1.0` |
| Tests | Blocked (cannot run) |
| Build deps | `@relay-assistant/routing` (devDep via `file:`) |
| External deps | `nanoid: ^5.1.6` declared in `dependencies` but **NOT INSTALLED** |
| **Blocker** | **DEP-001:** `nanoid` missing from workspace node_modules; tests cannot run. Gate G1 fails. |
| Secondary blocker | Blocked by routing DoD gap (prebuild depends on routing) |
| Earliest milestone | v1 (after nanoid installed and routing unblocked) |
| **Verdict** | **DEFER** — must not publish until nanoid installed and routing unblocked |

**Unblock path:** `npm install nanoid` in connectivity workspace; resolve routing blocker; verify all tests pass.

---

### `@relay-assistant/coordination` — DEFERRED v1

| Field | Value |
|-------|-------|
| Path | `packages/coordination` |
| npm name | `@relay-assistant/coordination` |
| Version | `0.1.0` |
| Tests | Blocked (depends on connectivity) |
| Build deps | `@relay-assistant/connectivity` (dep via `file:`) + `@relay-assistant/routing` (devDep) |
| **Blocker** | **BLOCKED-BY-CONNECTIVITY:** Cannot build or test until connectivity is unblocked. |
| Note | `dependencies` lists `@relay-assistant/connectivity: file:../connectivity` — this MUST be changed to a version range before publish |
| Earliest milestone | v1 (after connectivity unblocked) |
| **Verdict** | **DEFER** — cascading block from connectivity |

**Unblock path:** Unblock connectivity first; change `file:` dep to `"@relay-assistant/connectivity": ">=0.1.0"`; verify all tests pass.

---

### `@relay-assistant/memory` — DEFERRED v1.1

| Field | Value |
|-------|-------|
| Path | `packages/memory` |
| npm name | `@relay-assistant/memory` |
| Version | `0.1.0` |
| Tests | Unknown (dep missing) |
| External deps | `@agent-relay/memory: file:../../../relay/packages/memory` — **external file: ref to separate repo** |
| **Blocker** | **DEP-002:** `@agent-relay/memory` dependency is a `file:` reference to a sibling repo (`../../../relay/`), which is not available in CI and cannot be resolved in a published package. |
| Earliest milestone | v1.1 |
| **Verdict** | **DEFER** — requires `@agent-relay/memory` to be a published npm package |

**Unblock path:** `@agent-relay/memory` must be published to npm; update dependency to use published version range.

---

### `@relay-assistant/proactive` — DEFERRED v1.2

| Field | Value |
|-------|-------|
| Path | `packages/proactive` |
| npm name | `@relay-assistant/proactive` |
| Version | `0.1.0` |
| Status | Placeholder — no spec |
| **Blocker** | **SPEC-001:** Package is a placeholder with no design specification. Publishing a placeholder package pollutes the npm registry. |
| Earliest milestone | v1.2 |
| **Verdict** | **DEFER** — requires complete spec and implementation |

---

### `@relay-assistant/policy` — DEFERRED v2

| Field | Value |
|-------|-------|
| Path | `packages/policy` |
| npm name | `@relay-assistant/policy` |
| Version | `0.1.0` |
| Status | Placeholder — no spec |
| **Blocker** | **SPEC-002:** Package is a placeholder with no design specification. |
| Earliest milestone | v2 |
| **Verdict** | **DEFER** — requires complete spec and implementation |

---

## Never-Publish Packages

| Package | npm Name | Reason |
|---------|----------|--------|
| `@relay-assistant/examples` | same | `"private": true` in package.json — reference only |
| `@relay-assistant/integration-tests` | same | `"private": true` in package.json — test harness only |

These packages MUST NOT be added to the publish workflow `options` list under any circumstances.

---

## Required package.json Changes Before Any Publish

All four publish-now packages are missing two required fields. These must be applied in a single commit before the first publish run:

```json
// Add to each of: packages/traits, packages/core, packages/sessions, packages/surfaces
{
  "repository": {
    "type": "git",
    "url": "https://github.com/<org>/relay-agent-assistant"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

The `<org>` placeholder must be replaced with the actual GitHub organization name before committing.

---

## Publish Order (DAG)

When publishing `all`, packages must be published in this order to satisfy peer dependency resolution:

```
traits  →  core  →  sessions
                  →  surfaces
```

`traits` has no internal dependencies and must publish first. `core` depends on `traits` as a peer dependency. `sessions` and `surfaces` are independent of each other and can publish in parallel after `core`.

---

## Readiness Gate Summary Table

| Package | G1 Tests | G2 Build | G3 No-broken-file: | G4 Not-private | G5 publishConfig | G6 repository.url | Verdict |
|---------|----------|----------|---------------------|----------------|------------------|-------------------|---------|
| traits | PASS (32/30) | PASS | PASS | PASS | **ADD** | **ADD** | PUBLISH NOW |
| core | PASS (31/30) | PASS | PASS (file: is devDep only) | PASS | **ADD** | **ADD** | PUBLISH NOW |
| sessions | PASS (25/20) | PASS | PASS | PASS | **ADD** | **ADD** | PUBLISH NOW |
| surfaces | PASS (28/25) | PASS | PASS | PASS | **ADD** | **ADD** | PUBLISH NOW |
| routing | FAIL (12/40+) | PASS | PASS | PASS | MISSING | MISSING | DEFER v1 |
| connectivity | FAIL (blocked) | FAIL | PASS | PASS | MISSING | MISSING | DEFER v1 |
| coordination | FAIL (blocked) | FAIL | FAIL (file: in deps) | PASS | MISSING | MISSING | DEFER v1 |
| memory | FAIL (blocked) | FAIL | FAIL (external file:) | PASS | MISSING | MISSING | DEFER v1.1 |
| proactive | UNKNOWN | UNKNOWN | PASS | PASS | MISSING | MISSING | DEFER v1.2 |
| policy | UNKNOWN | UNKNOWN | PASS | PASS | MISSING | MISSING | DEFER v2 |
| examples | N/A | N/A | N/A | **private:true** | N/A | N/A | NEVER |
| integration | N/A | N/A | N/A | **private:true** | N/A | N/A | NEVER |

---

PUBLISH_PACKAGE_READINESS_MATRIX_READY
