All changes have been applied successfully. Here is a summary of what was accomplished:

---

## SPEC_RECONCILED — Summary

All edits from `docs/architecture/canonical-spec-fix-plan.md` have been applied to the four target files.

### `docs/specs/v1-core-spec.md`
- **Edit 1.1/1.2** — Removed "Inbound message normalization" from the Owns list; added normalization boundary note clarifying core receives already-normalized `InboundMessage` from the surfaces layer
- **Edit 1.3** — Added `userId: string` (required) and `workspaceId?: string` (optional) to `InboundMessage`
- **Edit 1.4** — Made `OutboundEvent.surfaceId` optional with updated JSDoc (`When present, targeted send. When absent, session fanout.`)
- **Edit 1.5** — Added section 3.10 `OutboundEventError` class definition
- **Edit 1.6** — Replaced `runtime.emit()` JSDoc with normative routing rule (targeted / fanout / invalid)
- **Edit 1.7** — Updated `RelayInboundAdapter` handler signature from `(raw: unknown)` to `(message: InboundMessage)` with updated comment (surfaces layer, not relay foundation)
- **Edit 1.8** — Updated `RelayOutboundAdapter` to add optional `fanout?()` method; updated comment to surfaces layer
- **Edit 1.9** — Updated First Implementation Slice Step 3 to reflect pre-normalized message dispatch
- **Edit 1.10** — Appended `SPEC_RECONCILED` marker

### `docs/specs/v1-surfaces-spec.md`
- **Edit 2.1** — Added bullet: `RelayInboundAdapter` and `RelayOutboundAdapter` implementation under Owns
- **Edit 2.5** — Added JSDoc to `SurfaceRegistry` interface declaring it implements both core adapter interfaces
- **Edit 2.3** — Rewrote section 4.9 from `RelayInboundSurfaceAdapter` interface to "Inbound Adapter Contract" describing `onMessage`/`offMessage` from core and `receiveRaw()` for the relay foundation, replacing `setInboundHandler()` with the standard adapter contract
- **Edit 2.2** — Added `userId` and `workspaceId` rows to normalization table (section 4.10) with required-field note
- **Edit 2.4** — Added "Outbound Routing Rule (normative)" subsection to section 8 with targeted/fanout/invalid rules
- **Edit 2.6** — Appended `SPEC_RECONCILED` marker

### `docs/specs/v1-sessions-spec.md`
- **Edit 3.2** — Changed `(resume)` annotation in lifecycle diagram to `(touch)`
- **Edit 3.1** — Replaced "may be resumed" / "Permanently closed" in the state table with canonical wording: `transitions back to active via touch()` / `Terminal state. No further transitions.`

### `docs/workflows/v1-workflow-backlog.md`
- **Edit 3.3** — Replaced "session resumed" in WF-7 step 10 with "session reactivated via touch"
