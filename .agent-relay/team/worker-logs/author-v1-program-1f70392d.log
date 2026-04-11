All three files have been written. Here is a summary of what was produced:

---

## Artifacts Produced

### `docs/architecture/v1-sectioning-and-priorities.md` (rewritten)

- Added a canonical source of truth header with an explicit API crosswalk table mapping old planning vocabulary to current spec vocabulary (e.g., `AssistantConfig` → `AssistantDefinition`, `handleMessage` → `dispatch`, `createSurfaceConnection` → `SurfaceConnection` + `createSurfaceRegistry`, session `resume`/`close` → `touch`/`expire`)
- Updated v1 packages section to list the actual spec-defined types and factory functions, not the outdated planning vocabulary
- Added the normative targeted-send-vs-fanout rule
- Updated all file path references to actual file names (`v1-core-spec.md`, not `core-v1.md`)
- Added explicit notes on spec-exists-early vs implementation-milestone-later for memory, connectivity, routing specs already marked IMPLEMENTATION_READY
- v1.1 connectivity gap obligations updated to reflect they are resolved in spec, pending in implementation only

### `docs/workflows/v1-workflow-backlog.md` (rewritten)

- Aligned all workflow steps to canonical spec API names
- Corrected WF-3 to use `touch`/`expire`/`attachSurface`/`detachSurface`/`sweepStale` (not `suspend`/`resume`/`close`)
- Corrected WF-2 to use capability dispatch table and `dispatch()`/`emit()` (not `onMessage` return value handler)
- Corrected WF-5 to be an explicit cross-package workflow requiring `SurfaceRegistry` to implement both relay adapter interfaces
- Added a dependency graph, parallelization map, and execution order table
- Added "First implementation workflow docs to write next" section with ordered list
- Ends with `V1_WORKFLOW_BACKLOG_READY`

### `docs/workflows/weekend-delivery-plan.md` (rewritten)

- All three product assembly examples (Sage, MSD, NightCTO) updated to spec-conformant TypeScript:
  - `AssistantDefinition` with `capabilities: Record<string, CapabilityHandler>` (not array)
  - Handlers use `context.runtime.emit()` (not return value)
  - Sessions wired via `runtime.register('sessions', sessionStore)` and resolved via `context.runtime.get<SessionStore>('sessions')` + `resolveSession()`
  - Surfaces use `createSurfaceRegistry()` + `SurfaceConnection` objects (not `createSurfaceConnection()`)
- Saturday morning focuses on confirming specs and scaffolding rather than writing specs (specs already done)
- WF-5 cross-package note added to Saturday evening section
- Risk flags updated with spec-vocabulary drift as the primary risk
- After-weekend next steps updated to reflect workflow document authoring as the highest priority
