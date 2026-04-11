# Spec Program Review Verdict

Date: 2026-04-11
Reviewer mode: non-interactive
Verdict: PASS_WITH_FOLLOWUPS

## Executive Verdict

The spec program is materially closer to implementation-ready than the earlier docs-first plan. The package-level specs for core, sessions, surfaces, memory, connectivity, and routing are concrete enough to drive engineering work. They define owned boundaries, public interfaces, state models, factory functions, and package interactions at a usable level.

This is not a clean `PASS` because the architecture/program/workflow docs still describe a different API than the package specs. If implementation starts directly from the current package specs, work can proceed this weekend. If engineers use the backlog, weekend plan, or adoption examples as their source of truth, they will implement the wrong surface area and create immediate churn.

## Assessment

### 1. Are these docs concrete enough to become implementation inputs this weekend?

Yes, with one condition: the package specs must be treated as the source of truth, and the planning/workflow docs must be aligned to them before implementation workflows begin.

What is strong:

- The package specs are specific about responsibilities, non-goals, interfaces, state machines, and boundaries.
- `docs/specs/v1-core-spec.md` defines a real runtime contract, message envelopes, hooks, subsystem registration, and outbound event handling.
- `docs/specs/v1-sessions-spec.md` defines a usable session entity, store interface, adapter boundary, affinity hook, and lifecycle behavior.
- `docs/specs/v1-surfaces-spec.md` defines surface registry responsibilities, normalization, formatting, fanout, and relay boundary clearly.
- `docs/specs/v1-memory-spec.md`, `docs/specs/v1-connectivity-spec.md`, and `docs/specs/v1-routing-spec.md` are also much more implementation-shaped than “placeholder roadmap” docs.

What prevents a clean `PASS`:

- The plan/backlog/weekend docs still describe older API names and behaviors that no longer match the specs.
- The examples intended for Sage, MSD, and NightCTO adoption are currently not valid against the spec-defined API.

### 2. Is the v1 sectioning coherent and useful?

Mostly yes.

The version split itself is coherent:

- v1 as `core + sessions + surfaces` is the correct minimum adoption skeleton.
- v1.1 as `memory + connectivity` is a sensible next gate for Sage and NightCTO.
- v1.2 as `proactive + coordination + routing` is coherent, and the justification for not deferring routing to v2 is sound.

What weakens the sectioning:

- The sectioning doc still names v1 deliverables using the outdated API vocabulary rather than the current spec vocabulary.
- The document says v1.1 connectivity still has six unresolved gaps, while `docs/specs/v1-connectivity-spec.md` is already marked `IMPLEMENTATION_READY`. Those two claims should not coexist without an explicit “supersedes prior gap verdict” note.
- The sectioning doc points to `docs/specs/core-v1.md`, `sessions-v1.md`, and `surfaces-v1.md`, while the actual files reviewed are `v1-core-spec.md`, `v1-sessions-spec.md`, and `v1-surfaces-spec.md`.

So the sectioning model is useful, but the naming and status references need cleanup immediately.

### 3. Is the workflow backlog sequenced sensibly?

Broadly yes, but only at the dependency level.

What is sensible:

- Starting with core, then sessions, then surfaces integration, is reasonable.
- WF-1/WF-3 parallelism is reasonable.
- WF-4 after core and sessions is correct.
- WF-6/WF-7 as integration layers is correct.

What needs tightening:

- WF-5 is described as a `surfaces` workflow, but it requires `assistant.attachSurface()` in core. That is a cross-package workflow, not a surfaces-only workflow.
- WF-5 says delivery goes only to the originating surface, while the surfaces spec already defines explicit fanout behavior. The backlog needs one authoritative statement about when targeted send vs session fanout happens.
- WF-3 uses `suspend`, `resume`, and `close`, but the sessions spec defines `touch`, `attachSurface`, `detachSurface`, `expire`, and `sweepStale`. That is not a small wording issue; it changes what engineers would implement.
- WF-2 describes `assistant.onMessage(handler)` and `assistant.handleMessage(...)`, but the core spec defines capability dispatch plus `dispatch(...)`, with `hooks.onMessage` acting as a pre-dispatch filter rather than the main product handler registration API.

The order is workable. The workflow definitions are not yet trustworthy enough to hand to implementers unchanged.

### 4. Are Sage, MSD, and NightCTO adoption goals actually reflected?

Partially.

They are reflected strategically:

- The v1 success definition and consumer-readiness checklist are explicitly framed around Sage, MSD, and NightCTO adoption.
- The sectioning doc correctly identifies that all three need v1, Sage and NightCTO need memory quickly, and NightCTO/MSD need deeper later-stage packages.
- The weekend plan includes product-specific adoption paths for all three products.

They are not fully reflected operationally:

- The product adoption examples use an API that does not match the current specs.
- The example `capabilities` values are arrays in the weekend plan, while the core spec defines `capabilities: Record<string, CapabilityHandler>`.
- The examples rely on `assistant.onMessage(...)`, `assistant.attachSurface(createSurfaceConnection(...))`, and `createSessionStore()` with no adapter config, none of which line up cleanly with the reviewed specs.
- Because the examples are stale, the adoption guidance does not yet give Sage, MSD, or NightCTO a reliable “copy this shape into product code” baseline.

The goals are present in roadmap intent, but not yet in implementation-credible examples.

### 5. What still needs tightening before implementation workflows begin?

These are the required tightening items:

1. Pick one canonical API vocabulary and update every planning/workflow/adoption doc to it.
   - Core currently conflicts between `AssistantConfig`/`Assistant`, `handleMessage`, `assistant.onMessage(...)`
   - vs spec-defined `AssistantDefinition`/`AssistantRuntime`, capability handlers, and `dispatch(...)`.

2. Resolve the sessions lifecycle mismatch.
   - Program docs describe `created -> active -> suspended -> resumed -> closed`.
   - Sessions spec defines `created -> active -> suspended -> expired`, with `touch()` resuming by transition back to `active`.
   - Decide whether explicit `resume`/`close` exist or whether `touch`/`expire` are the actual public API.

3. Resolve the surfaces construction mismatch.
   - Program docs and examples use `createSurfaceConnection(...)`.
   - Surfaces spec centers on `createSurfaceRegistry(...)` plus registered `SurfaceConnection` objects.
   - Decide whether v1 exports both, or whether the plan docs must be updated to registry-first assembly.

4. Clarify the outbound targeting rule.
   - Backlog WF-5 and WF-6 assume “respond to originating surface.”
   - Surfaces spec defines both targeted send and session fanout.
   - Core/surfaces boundary needs one short normative rule for when `send()` is used and when `fanout()` is used.

5. Update the example assemblies in `docs/workflows/weekend-delivery-plan.md`.
   - They currently show stale APIs and would mislead product teams.
   - This is the highest-leverage fix for Sage/MSD/NightCTO adoption credibility.

6. Fix file-path references throughout the plan docs.
   - Planning docs reference `docs/specs/core-v1.md`, `sessions-v1.md`, `surfaces-v1.md`.
   - The reviewed docs are `docs/specs/v1-core-spec.md`, `v1-sessions-spec.md`, `v1-surfaces-spec.md`.

7. Reconcile status claims for v1.1/v1.2 docs.
   - The sectioning/plan docs say memory/connectivity/routing come later.
   - The package specs for memory/connectivity/routing are already written and marked `IMPLEMENTATION_READY`.
   - That is acceptable, but the program docs should explicitly say those specs exist early while implementation remains deferred by version.

8. Tighten workflow ownership boundaries.
   - WF-5 and WF-6 are not purely surfaces work.
   - Mark cross-package ownership explicitly so implementation does not stall on hidden dependencies.

## Findings With References

### High Priority

1. Core API mismatch between plan/workflow docs and canonical spec.
   - Plan expects `AssistantConfig`, `Assistant`, `handleMessage`, plugin hooks, and `AssistantMessage` in `docs/architecture/spec-program-plan.md:95-102`.
   - Backlog repeats `assistant.onMessage(handler)` and `assistant.handleMessage(...)` in `docs/workflows/v1-workflow-backlog.md:62-75`.
   - Core spec instead defines `AssistantDefinition`, `AssistantRuntime`, capability handlers, `hooks.onMessage`, and `dispatch(...)` in `docs/specs/v1-core-spec.md:44-77`, `83-86`, `135-153`, and `174-214`.

2. Sessions lifecycle and method mismatch between plan/workflow docs and canonical spec.
   - Plan requires `resume`, `attach`, `detach`, and lifecycle `created -> active -> suspended -> resumed -> closed` in `docs/architecture/spec-program-plan.md:108-115`.
   - Backlog uses `suspend`, `resume`, and `close` in `docs/workflows/v1-workflow-backlog.md:88-102`.
   - Sessions spec instead defines `touch`, `attachSurface`, `detachSurface`, `expire`, and `sweepStale`, with states ending in `expired` rather than `closed`, in `docs/specs/v1-sessions-spec.md:42-58`, `67-105`, and `111-166`.

3. Surfaces construction and assembly mismatch between plan/workflow docs and canonical spec.
   - Plan/backlog/weekend docs assume `createSurfaceConnection(...)` and direct `assistant.attachSurface(...)` usage in `docs/architecture/spec-program-plan.md:121-128`, `docs/workflows/v1-workflow-backlog.md:141-156`, and `docs/workflows/weekend-delivery-plan.md:108-127`, `148-169`, `190-210`.
   - Surfaces spec instead defines `SurfaceConnection` plus `SurfaceRegistry` and `createSurfaceRegistry(...)` as the factory in `docs/specs/v1-surfaces-spec.md:61-92`, `185-223`, and `338-349`.

4. Product adoption examples are stale relative to the specs.
   - Weekend examples use `capabilities` arrays and `assistant.onMessage(...)` return-value handlers in `docs/workflows/weekend-delivery-plan.md:112-127`, `153-169`, and `195-210`.
   - Core spec requires `capabilities: Record<string, CapabilityHandler>` and handlers that emit through runtime context rather than return an outbound object in `docs/specs/v1-core-spec.md:60-65`, `83-86`, and `181-185`.

### Medium Priority

5. File naming is inconsistent across the program docs.
   - Plan, sectioning, backlog, and weekend plan still refer to `core-v1.md`, `sessions-v1.md`, `surfaces-v1.md` in `docs/architecture/spec-program-plan.md:91-128`, `docs/architecture/v1-sectioning-and-priorities.md:32-40`, `docs/workflows/v1-workflow-backlog.md:17-23`, and `docs/workflows/weekend-delivery-plan.md:20-24`.
   - The actual reviewed files are `v1-core-spec.md`, `v1-sessions-spec.md`, and `v1-surfaces-spec.md`.

6. Connectivity status is inconsistent across docs.
   - Sectioning says connectivity still has six unresolved gap obligations in `docs/architecture/v1-sectioning-and-priorities.md:83-94`.
   - Connectivity spec is already marked `IMPLEMENTATION_READY` in `docs/specs/v1-connectivity-spec.md:1-7`.
   - This may be a chronology issue, but it needs an explicit supersession note.

7. Workflow ownership is underspecified for cross-package slices.
   - WF-5 is labeled surfaces-only in `docs/workflows/v1-workflow-backlog.md:132-157`, but it depends on `assistant.attachSurface()` existing in core.
   - Weekend plan repeats the same simplification in `docs/workflows/weekend-delivery-plan.md:52-59`.

8. Fanout semantics need one explicit normative rule in the program docs.
   - WF-5/WF-6 emphasize “originating surface only” in `docs/workflows/v1-workflow-backlog.md:148` and `173-180`.
   - Surfaces spec defines both targeted `send()` and `fanout()` behavior in `docs/specs/v1-surfaces-spec.md:210-223` and `360-376`.

## Recommended Pre-Implementation Actions

Before any weekend coding workflow begins:

1. Update `spec-program-plan.md`, `v1-sectioning-and-priorities.md`, `v1-workflow-backlog.md`, and `weekend-delivery-plan.md` to match the reviewed package specs exactly.
2. Replace all stale product example code with spec-conformant examples.
3. Add a short “canonical source of truth” note to the plan docs saying package specs override planning docs when there is drift.
4. Add one API crosswalk section if renaming was intentional:
   - old terms -> current terms
   - `AssistantConfig` -> `AssistantDefinition`
   - `Assistant` -> `AssistantRuntime`
   - `handleMessage` -> `dispatch`
   - `close` -> `expire`
   - `createSurfaceConnection` -> `SurfaceConnection` object registered in `SurfaceRegistry` or confirm both exist
5. Reissue the workflow backlog after those corrections so implementers are not translating between two models.

## Bottom Line

The spec set is good enough to start implementation this weekend, but only if engineers treat the package specs as canonical and the program/workflow docs are synchronized first. The core risk is no longer missing detail; it is contradictory detail.

Artifact produced:
- `docs/architecture/spec-program-review-verdict.md`

SPEC_PROGRAM_REVIEW_COMPLETE
