All six spec files have been written to `docs/specs/`. Here is a summary of what was produced:

---

## Completed

**`docs/specs/v1-core-spec.md`** — `@relay-assistant/core`
Covers: assistant definition, capability dispatch, runtime lifecycle, relay adapter interfaces (`RelayInboundAdapter` / `RelayOutboundAdapter`), subsystem registry, full TypeScript interface contracts, 4 open questions, 7-step implementation slice. OSS-only. Dependency root for all other packages.

**`docs/specs/v1-sessions-spec.md`** — `@relay-assistant/sessions`
Covers: session entity (created/active/suspended/expired lifecycle), `SessionStore` with CRUD + surface attachment + stale sweep, `AffinityResolver` for continuity routing, injected `SessionStoreAdapter`, `resolveSession` utility for capability handlers. 5 open questions, 7-step slice.

**`docs/specs/v1-memory-spec.md`** — `@relay-assistant/memory`
Covers: five scope kinds (session/user/workspace/org/object), `MemoryStore` with write/retrieve/promote/compact, `CompactionCallback` interface (model-agnostic), expiry, tagging, scope inclusion rules. Explicitly defers semantic/embedding search to future. 5 open questions, 8-step slice.

**`docs/specs/v1-surfaces-spec.md`** — `@relay-assistant/surfaces`
Covers: `SurfaceConnection` with state machine, `SurfaceRegistry` with send + fanout, `SurfaceAdapter` and `SurfaceFormatHook` interfaces, `FanoutPolicy`/`FanoutResult`, inbound normalization from raw relay payloads to `InboundMessage`, `RelayInboundSurfaceAdapter` wiring pattern. 5 open questions, 7-step slice.

**`docs/specs/v1-connectivity-spec.md`** — `@relay-assistant/connectivity`
Covers: 5 message classes, 11 signal classes, full `ConnectivitySignal` envelope, signal state machine (emitted→active→superseded/expired/resolved), suppression window (step-basis or time-basis), `SelectedAudienceResolver`, `RoutingEscalationHook` cross-package contract, coordination call direction, all 4 workflow shapes (WF-C1 through WF-C4), explicit resolution of the 6 gaps from the review verdict. 5 open questions, 8-step slice.

**`docs/specs/v1-routing-spec.md`** — `@relay-assistant/routing`
Covers: cheap/fast/deep mode tiers (Workforce-informed), `ModelSpec` (abstract, provider-agnostic), 7-step decision algorithm with priority ordering, `RoutingPolicy` with per-capability overrides + cost envelope + mode ceiling + escalation mode map, `Router.onEscalation()` implementing `RoutingEscalationHook`, OSS/cloud boundary, circular-dependency avoidance between routing and connectivity. 6 open questions, 7-step slice.

Every file ends with `SPEC_READY`.
