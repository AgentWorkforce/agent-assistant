The sentinel is in place. All three files have been updated. Here is a summary of every change made:

---

## Changes Applied

### `docs/architecture/spec-program-plan.md`

1. **Spec status table** — removed `(pending Contradiction X resolution)` from core and surfaces rows; replaced with `IMPLEMENTATION_READY — SPEC_RECONCILED`.

2. **Pre-implementation gate block** — converted from future-tense requirement ("must be resolved") to past-tense confirmation ("have been resolved"). Each contradiction now shows "Resolved." status.

3. **Spec 1 description** — updated three inline contradiction references from `pending Contradiction N` to `Contradiction N resolved`, with section pointers matching the actual spec.

4. **Spec 3 inbound normalization line** — replaced stale `setInboundHandler(handler)` reference with the canonical `RelayInboundAdapter.onMessage()`/`offMessage()` contract per `v1-surfaces-spec.md §4.9`, with explicit note that `setInboundHandler` is superseded.

5. **Spec 3 outbound routing rule label** — updated from "Contradiction 3 resolution" (future) to "resolved — Contradiction 3; now in both specs".

6. **v1.1 section** — added spec-ahead note: `v1-memory-spec.md` and `v1-connectivity-spec.md` are already `IMPLEMENTATION_READY`; spec existing early does not change the v1.1 milestone. Updated package table to reflect `doc + spec (ahead of milestone)` entry stage.

7. **v1.2 section** — added spec-ahead note: `v1-routing-spec.md` is already `IMPLEMENTATION_READY`; implementation milestone remains v1.2. Updated routing package table entry.

8. **Execution Order table** — rows 0, 1, 3 updated to show completion (`SPEC_RECONCILED`).

---

### `docs/architecture/v1-sectioning-and-priorities.md`

1. **v1 Packages — surfaces row** — replaced `inbound normalization (receiveRaw / setInboundHandler)` with explicit description of the `receiveRaw` + `RelayInboundAdapter.onMessage`/`offMessage` contract, with note that `setInboundHandler` is retired.

2. **"Pending Spec Updates" section** — renamed to "Spec Contradictions — Resolved (Pre-WF-1 Gate Cleared)". Rewrote table as a resolved-state record showing what was applied rather than what is required.

3. **v1 Spec Documents table** — removed `(pending Contradiction X resolution)` from core and surfaces; replaced with `IMPLEMENTATION_READY — SPEC_RECONCILED`.

4. **WF-6 cross-package notes** — added explicit ownership clarification: when fanout is triggered, core uses `runtime.get('sessions')` internally to retrieve the `SessionStore` and read `session.attachedSurfaces`; the sessions subsystem must be registered before any fanout emit. Noted that sessions owns the list, surfaces owns delivery, core owns the routing decision.

5. **Fanout/targeted-send normative rule** — updated "This rule must be stated in both specs" → "This rule is stated in both specs" with section pointers (`§3.7` and `§8`).

---

### `docs/workflows/v1-workflow-backlog.md`

1. **Pre-workflow header** — changed "Required — block on this before WF-1" to "Complete — WF-1 implementation may begin".

2. **Contradiction resolutions subheading** — changed "must be resolved" to "have been resolved"; noted `SPEC_RECONCILED` status and all-actions-complete.

3. **Spec phase table** — removed `(pending Contradiction X resolution)` from core and surfaces; replaced with `SPEC_RECONCILED`.

4. **Contradiction resolution actions table** — all 8 actions changed from "Pending" to "**Resolved**".

5. **WF-1 `Depends on`** — updated qualifier from "after Contradiction 1–3 resolutions applied" to "(`SPEC_RECONCILED` — Contradiction 1–3 resolutions applied)".

6. **WF-5 `Depends on`** — updated qualifier to note `setInboundHandler` is retired in favor of `RelayInboundAdapter.onMessage`/`offMessage` contract.

7. **WF-6 fanout ownership note** — expanded to clarify the cross-package mechanism: core uses `runtime.get('sessions')` internally during fanout; session store must be registered before fanout emit; added ownership summary (sessions owns list, surfaces owns delivery, core owns routing decision).

8. **Execution Order table** — rows 0, 1, 3 updated to show completion.

9. **File ends with** `V1_WORKFLOW_BACKLOG_READY` ✓
