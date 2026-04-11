All remaining matches are intentional — they appear in the **API Crosswalk table** (v1-sectioning) and the **"do not use old planning vocabulary" list** (v1-workflow-backlog), both of which exist specifically to document the stale-to-current mapping. These are not usage occurrences; they are deprecation reference rows. No actual stale term usage remains.

---

## Summary

All three files have been written to disk. Here is what changed in each:

### `docs/architecture/spec-program-plan.md`
- **Stale file paths fixed throughout**: `docs/specs/core-v1.md` → `v1-core-spec.md`, `sessions-v1.md` → `v1-sessions-spec.md`, `surfaces-v1.md` → `v1-surfaces-spec.md`, `connectivity-v1.md` → `v1-connectivity-spec.md`
- **All stale API vocabulary replaced** in Spec 1/2/3 descriptions and WF-1 through WF-7: `AssistantConfig` → `AssistantDefinition`, `Assistant` → `AssistantRuntime`, `handleMessage` → `runtime.dispatch()`, `AssistantMessage` → `InboundMessage`/`OutboundEvent`, `createSurfaceConnection` → `SurfaceConnection` + `createSurfaceRegistry()`, `useSessions` → `runtime.register()`, `sessions.suspend/resume/close` → `touch/sweepStale/expire`, session states `resumed/closed` → `active/expired`
- **Pre-implementation gate added**: explicit callout for Contradiction 1–3 resolutions as blocking WF-1; links to reconciliation-rules.md checklist
- **Connectivity spec** status updated from "define in" to "defined in"; spec marked as already `IMPLEMENTATION_READY`
- **npm install clarification** added (Rule 5: local workspace references, not npm registry)
- **Spec 1/2/3 sections** now describe current spec contents accurately including pending Contradiction markers

### `docs/architecture/v1-sectioning-and-priorities.md`
- **Pre-WF-1 gates section added** with a table of the three Contradictions, required spec changes, and planning doc impacts
- **npm install clarification** added to v1 success definition and consumer readiness checklist
- **WF table** updated with Contradiction callout annotations on WF-2 (userId), WF-5 (normalization ownership), WF-6 (OutboundEventError)
- **Fanout/targeting normative rule** expanded to include the invalid case (`OutboundEventError` when both absent)
- **v1.2 routing spec note** added (spec already `IMPLEMENTATION_READY` speculatively)

### `docs/workflows/v1-workflow-backlog.md`
- **Pre-workflow section** expanded with reconciliation checklist table (8 actions, status, dependencies)
- **WF-2 acceptance criteria**: `InboundMessage` now includes `userId` (required) and `workspaceId?` (optional) per Contradiction 2; `OutboundEvent.surfaceId` now documented as optional per Contradiction 3; `OutboundEventError` added
- **WF-4**: explicit note that `resolveSession` reads `message.userId` directly — no manual extraction from `message.raw`
- **WF-5**: Cross-package ownership note expanded to explicitly state surfaces owns inbound normalization (Contradiction 1); normalization must extract `userId` (Contradiction 2)
- **WF-6**: Step 7 and acceptance criteria now include `OutboundEventError` test for invalid emit (Contradiction 3)
- **WF-7**: Assembly pattern references canonical pattern from spec-reconciliation-rules.md §3b
- **Execution order table**: Step 0 added for Contradiction resolution actions
- **wf-2 dispatch guide note**: expanded to mention `OutboundEvent.surfaceId` optional and `OutboundEventError`
- Ends with `V1_WORKFLOW_BACKLOG_READY`
