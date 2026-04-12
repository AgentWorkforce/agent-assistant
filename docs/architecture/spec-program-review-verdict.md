# Spec Program Review Verdict

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Reviewer mode: non-interactive
Verdict: FAIL

## Findings

### High

1. Core and surfaces disagree on who owns inbound normalization and which adapter interface is wired at runtime.
   - `docs/specs/v1-core-spec.md` says core owns inbound normalization and expects `RelayInboundAdapter.onMessage/offMessage` over raw events.
   - `docs/specs/v1-surfaces-spec.md` says surfaces owns normalization, defines `receiveRaw()/setInboundHandler()`, and the workflow docs wire `surfaceRegistry` directly into `createAssistant(...)`.
   - These are not equivalent contracts. WF-5 and the end-to-end assembly cannot be implemented cleanly until one boundary is chosen.

2. Core and sessions disagree on the minimum identity fields needed for session resolution.
   - `docs/specs/v1-core-spec.md` defines `InboundMessage` with `id`, `surfaceId`, `sessionId?`, `text`, `raw`, `receivedAt`, `capability`.
   - `docs/specs/v1-sessions-spec.md` and the v1 workflows assume `resolveSession(message, store, resolver)` can create or resume sessions by `userId` and often `workspaceId`.
   - There is no canonical `userId` or `workspaceId` on `InboundMessage`, so WF-4, WF-6, and the Sage/MSD/NightCTO examples depend on data that the core contract does not expose.

3. Core and surfaces disagree on outbound targeting.
   - `docs/specs/v1-core-spec.md` makes `OutboundEvent.surfaceId` required.
   - `docs/specs/v1-surfaces-spec.md`, `docs/architecture/v1-sectioning-and-priorities.md`, and `docs/workflows/v1-workflow-backlog.md` all require a fanout case where an event has `sessionId` but no `surfaceId`.
   - Targeted send versus session fanout cannot be implemented without changing `OutboundEvent` or introducing distinct outbound event shapes.

4. The workflow phase is sequenced inconsistently across the reviewed docs.
   - `docs/architecture/spec-program-plan.md` says workflow documents are Stage 3 and code is Stage 4, and that v1 specs must be finalized before code is committed.
   - `docs/workflows/weekend-delivery-plan.md` schedules scaffolding and implementation this weekend, then lists drafting workflow guides as work that starts after the weekend.
   - That breaks the stated “workflow as unit of implementation” model.

### Medium

5. The v1 sectioning is structurally good, but it relies on crosswalks because the plan and backlog still carry older assembly assumptions.
   - `docs/architecture/v1-sectioning-and-priorities.md` is useful as a correction layer, but needing a correction layer this early is itself a sign that the docs are not yet stable enough for direct implementation handoff.

6. The adoption goal is explicit but not fully operationalized.
   - The docs repeatedly say Sage, MSD, and NightCTO should be able to `npm install` the v1 packages by Sunday night.
   - The same sectioning doc marks npm publishing configuration out of scope.
   - If “npm install” means published packages, the delivery plan is missing packaging/release work. If it means local workspace consumption, the docs should say that directly.

7. v1.1 and v1.2 specs are detailed and useful, but they add noise to a weekend implementation push centered on v1.
   - They are not a blocker themselves.
   - They do, however, create pressure to reason about future boundaries before the v1 cross-package contracts are settled.

## Assessment

### 1. Are these docs concrete enough to become implementation inputs this weekend?

Not yet.

The package specs are individually concrete. The problem is that the cross-package contracts do not line up on three critical paths:

- inbound flow: relay -> surfaces -> core
- session resolution: core message -> sessions identity lookup
- outbound flow: targeted send versus session fanout

Those are implementation inputs, not editorial details. Starting code before fixing them will create churn immediately.

### 2. Is the v1 sectioning coherent and useful?

Yes, mostly.

The version split is coherent:

- v1 = `core + sessions + surfaces`
- v1.1 = `memory + connectivity`
- v1.2 = `proactive + coordination + routing`

That sequence is useful for adoption planning, and the product notes for Sage, MSD, and NightCTO are directionally correct. The weakness is not the sectioning model; it is that the weekend workflows still sit on top of unresolved v1 contract mismatches.

### 3. Is the workflow backlog sequenced sensibly?

Mostly yes at the dependency level, but not yet safe to execute as written.

Good:

- WF-1 and WF-3 in parallel is sensible.
- WF-2 after WF-1 is sensible.
- WF-4 after WF-2 and WF-3 is sensible.
- WF-6 and WF-7 as integration layers is sensible.

Not good enough yet:

- WF-5 assumes a concrete core-surfaces wiring that the specs currently contradict.
- WF-4 assumes session resolution inputs that the core message contract does not currently provide.
- The delivery plan also conflicts with the stated doc -> spec -> workflow -> code pipeline.

### 4. Are Sage, MSD, and NightCTO adoption goals actually reflected?

Yes at the roadmap level, only partially at the implementation level.

Reflected:

- All three products are named in the v1 goal and consumer-readiness criteria.
- The sectioning doc correctly maps near-term needs: all need v1, Sage and NightCTO need memory quickly, NightCTO and MSD need deeper later packages.
- The weekend plan includes product-specific adoption paths.

Not yet reflected strongly enough:

- Those adoption paths depend on `resolveSession(message, ...)`, but `message` does not carry canonical identity fields.
- They also depend on the current core-surfaces assembly examples being valid, which they are not until the adapter boundary is reconciled.
- The “npm install by Sunday night” promise is not backed by an explicit packaging/release path.

### 5. What still needs tightening before implementation workflows begin?

These items should be resolved before coding starts:

1. Choose one inbound boundary.
   - Option A: core owns raw-event normalization; surfaces only handles outbound formatting/registry.
   - Option B: surfaces owns normalization and passes canonical `InboundMessage` into core.
   - Then make the adapter interfaces and examples match that choice everywhere.

2. Add canonical identity fields to the message path used for session resolution.
   - Minimum likely fields: `userId`.
   - Probably also `workspaceId?` if workspace affinity is a real v1 requirement.
   - If those fields intentionally stay out of `InboundMessage`, then `resolveSession(...)` needs a different input contract.

3. Resolve targeted send versus fanout in the outbound contract.
   - Make `surfaceId` optional on `OutboundEvent`, or
   - split outbound events into targeted and session-scoped variants.
   - Then restate the normative rule once in the core/surfaces boundary and once in the workflow backlog.

4. Reconcile the workflow model with the weekend plan.
   - Either workflows are required implementation guides before code, or they are parallel planning artifacts. The docs currently claim both.

5. Clarify the release/adoption promise.
   - If packages will be published to npm this weekend, add the packaging/release work.
   - If teams will consume from the monorepo or tarballs first, replace `npm install` with the actual adoption path.

6. Reduce weekend scope noise.
   - Keep memory, connectivity, and routing as reviewed future inputs, but make the weekend plan explicitly v1-only so implementers do not treat future-package detail as part of the current build.

## Bottom Line

The docs are close, but they are not ready to serve as direct implementation inputs this weekend because the main v1 package boundaries still conflict on inbound flow, session identity, and outbound delivery semantics.

Artifact produced:
- `docs/architecture/spec-program-review-verdict.md`

SPEC_PROGRAM_REVIEW_COMPLETE
