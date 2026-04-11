Both files are now complete and spec-conformant. Here is a summary of all changes made:

---

## Summary

### `docs/consumer/how-to-build-an-assistant.md`

1. **Completed the stale API names table** in "What To Avoid" — expanded from a partial inline list to a full table matching Rule 1 of `spec-reconciliation-rules.md`, adding the previously missing entries: `Assistant` (live object) → `AssistantRuntime`, `assistant.onMessage(handler)` → `capabilities`, `AssistantMessage` → `InboundMessage`/`OutboundEvent`, `sessions.suspend(id)` → `sessionStore.sweepStale(ttlMs)`, session states `resumed` and `closed`.

2. **Added `store.attachSurface()` + fanout example** to the skeletal assembly — the targeted send was already present; added `attachSurface` (needed for fanout to work) and a commented-out fanout `emit` with an `OutboundEventError` note, demonstrating the full targeted-vs-fanout-vs-invalid rule from Contradiction 3 resolution.

3. **Added canonical conformance note to the Product Examples section** — a blockquote directly above the Sage/MSD/NightCTO entries that says "If these examples ever drift from the specs in `docs/specs/`, trust the specs."

### `docs/workflows/weekend-delivery-plan.md`

1. **Added fanout example to the MSD assembly** — MSD is explicitly described as a multi-surface (Slack + web) product. The existing example showed `attachSurface` but not how to fanout. Added a commented-out session-fanout `emit` with a PR-review-specific comment, demonstrating the normative outbound routing rule (targeted send when `surfaceId` present; fanout when absent but `sessionId` present).

All other content in both files was already spec-conformant against the reconciled v1 specs (`SPEC_RECONCILED` in core spec, all three contradictions resolved). No stale API names remain in either file.
