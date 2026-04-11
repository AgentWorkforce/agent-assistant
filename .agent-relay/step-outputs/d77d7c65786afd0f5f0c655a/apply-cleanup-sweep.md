Applied the post-audit cleanup sweep and wrote the changes to disk.

Updated:
- `README.md`
- `docs/index.md`
- `docs/architecture/package-boundary-map.md`
- `docs/architecture/traits-and-persona-layer.md`
- `docs/architecture/sdk-audit-and-traits-alignment-plan.md`
- `docs/workflows/v1-workflow-backlog.md`
- `docs/workflows/weekend-delivery-plan.md`
- `packages/routing/README.md`
- `packages/coordination/README.md`
- `docs/architecture/post-audit-cleanup-plan.md`

What changed:
- corrected stale implementation/test-count status wording to current counts: core `44`, connectivity `87`, coordination `45`, total `241`
- fixed the stale workflow status in `docs/index.md` to `WF-1 through WF-6 COMPLETE; WF-7 OPEN`
- resolved the `AssistantDefinition.traits` timing inconsistency so docs consistently say:
  - no `traits` field exists in v1
  - no `traits` field is added in v1.1
  - `traits?: TraitsProvider` is only added when `@relay-assistant/traits` ships in v1.2
- added the missing routing README note that same-priority escalation ties pick the deepest mapped mode
- added the missing coordination README routing-integration section, including the current v1 limitation around `activeEscalations`
- expanded the coordination README testing section to reflect the current 45-test suite
- appended `POST_AUDIT_CLEANUP_APPLIED` to `docs/architecture/post-audit-cleanup-plan.md`

Verification:
- confirmed `packages/core/src/types.ts` still has no `traits` field on `AssistantDefinition`
- grep check shows the targeted stale count/status phrases are cleared from the live docs touched by this sweep; remaining matches are in historical review/plan text describing prior drift

Artifacts produced:
- narrowed doc-only cleanup edits in the files above
- required marker appended: `POST_AUDIT_CLEANUP_APPLIED`
