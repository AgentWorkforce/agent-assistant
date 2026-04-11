Verdict written to `docs/architecture/v1-routing-review-verdict.md`.

**VERDICT: PASS_WITH_FOLLOWUPS**

The routing package is architecturally solid. Here is the summary:

---

### What passes cleanly

- All types match the spec (including `RouterConfig.defaultModelSpecs` which the plan omitted)
- Seven-step decision algorithm in correct priority order
- `modeCeiling` post-filter applied correctly to all candidates
- `onEscalation()` applies ceiling, correctly ignores non-escalation signal classes
- Per-thread cost accumulation/read/reset
- `DEFAULT_MODE_SPECS` matches the spec §6 table (not the plan §3.9 which had zeroed values)
- Zero runtime dependencies — connectivity boundary fully decoupled
- No scope overreach — no provider SDK, no session/surface/memory imports

---

### Blocking follow-up (F-1)

**Test count is 11 vs 40+ required by the plan's DoD.** Missing: boundary conditions for cost envelope (at-limit vs over-limit), per-thread isolation, latency-not-applied when unspecified, mode ceiling passthrough at `deep`, and per-group granularity tests.

---

### Non-blocking follow-ups before wiring

- **F-2**: `escalated: true` is incorrectly set on hard-constraint caps of non-escalated (caller-requested) decisions. Should be `candidate.escalated` only.
- **F-3/F-4**: `RoutingEscalationHook` and `RequestedRoutingMode` are duplicated in both packages independently — latent drift risk.
- **F-5**: `CoordinatorConfig` has no `router` field yet. Coordination can't perform mode-selection before delegation, which is the primary v1 value of this package.
- **F-6**: The OQ-5 tiebreaker deviation (deepest mode wins at same priority) is undocumented.

V1_ROUTING_REVIEW_COMPLETE
