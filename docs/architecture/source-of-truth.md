# Source of Truth

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

This document states the precedence hierarchy for this repository. When documents conflict, resolve by applying this order.

---

## Hierarchy (highest to lowest)

1. **Source code** — the actual implementation in `packages/*/src/`
2. **Package specs** — canonical contracts in `docs/specs/` (files named `v1-{package}-spec.md`)
3. **Package READMEs** — `packages/*/README.md`
4. **Index and status docs** — `README.md`, `docs/index.md`, `docs/current-state.md`
5. **Plans** — `docs/architecture/v1-*-implementation-plan.md` and similar
6. **Review verdicts** — `docs/architecture/v1-*-review-verdict.md` and similar

**Status markers in READMEs and index docs are derived, not authoritative.** If they conflict with code or specs, trust the code and specs.

---

## Spec Status Markers

| Marker | Meaning |
| --- | --- |
| `SPEC_RECONCILED` | Code and spec agree; confirmed by a review verdict |
| `IMPLEMENTATION_READY` | Spec is complete and reviewed; code-vs-spec reconciliation not yet confirmed |

---

## Canonical vs. Duplicate Specs

`docs/architecture/connectivity-package-spec.md` is the original architecture-level design document. The canonical v1 spec is `docs/specs/v1-connectivity-spec.md`. When they conflict, trust `docs/specs/v1-connectivity-spec.md`.

For all other packages, `docs/specs/v1-{package}-spec.md` is the sole canonical contract.

---

## When to Update This Document

Update this document if the hierarchy changes (e.g., a new doc tier is added) or if a new duplicate-spec situation arises that needs an explicit canonical pointer.

Do not use this document to record per-package status — that belongs in `docs/current-state.md`.

---

SOURCE_OF_TRUTH_READY
