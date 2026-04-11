Both files are updated. Here's a summary of what was done:

---

## Summary

### `docs/consumer/how-to-build-an-assistant.md` — full reconciliation pass

**Stale API names removed/replaced (Rule 1):**
- `createSurfaceConnection` → `createSurfaceRegistry` (imports section)
- `createAssistant({ id, name, capabilities: [...] })` single-arg form → `createAssistant(definition, { inbound, outbound })` two-arg form
- `capabilities: ["review", ...]` as array → `capabilities: Record<string, CapabilityHandler>`
- `createSessionStore()` → `createSessionStore({ adapter })`
- `assistant.useSessions()`, `assistant.useMemory()`, etc. → `runtime.register(name, subsystem)`
- `assistant.attachSurface(createSurfaceConnection({...}))` → `surfaceRegistry.register(connection)` pattern

**Added:**
- Canonical note at the top (Rule 0 + reconciliation rules pointer)
- `What To Avoid` now explicitly lists stale API names and references Rule 1
- Skeletal assembly example fully rewritten to follow Rule 3b assembly pattern
- Product examples (Sage, MSD, NightCTO) updated with version tags for future packages and cross-references to weekend plan for code examples

### `docs/workflows/weekend-delivery-plan.md` — targeted fixes

The file was already substantially reconciled. Two additions applied:
1. **Header revision note** updated to reference `spec-reconciliation-rules.md` explicitly
2. **Rule 5 workspace-protocol note** added to header and consumer readiness checklist — clarifies that v1 "npm install" resolves via workspace references, not the public npm registry

All Sage, MSD, and NightCTO code examples in the weekend plan were verified clean against the Rule 3d checklist: correct factory names, spec-conformant assembly pattern, `resolveSession` used, no stale terms present.
