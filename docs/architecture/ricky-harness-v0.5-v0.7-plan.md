# 1. Steps (minimal, executable)
1. Run deterministic preflight checks and capture a local snapshot of the workflow-writing skill and current routing state.
2. Generate this plan artifact deterministically so launch-time behavior is stable and model-agnostic.
3. Execute the v0.5 implementation slice, then run first-pass build/test evidence capture and repair loop until hard validation passes.
4. Execute the v0.6/v0.7 implementation slices, then run first-pass evidence capture and repair loop until hard validation passes.
5. Run final deterministic validation + diff gate, then reviewer signoff and final contract gate.

# 2. Wiring (how plan maps to existing routing modes and negotiation surfaces)
- Routing compatibility is preserved with existing policy-driven `cheap | fast | deep` mode selection in `packages/routing`.
- Workflow prompts remain model-agnostic and do not bind to any specific model name.
- Streaming negotiation wiring remains explicit: `prefer` allows downgrade, `require` must fail fast when unavailable, `forbid` forces non-streaming execution.
- Bounded-turn behavior is preserved: repair loops are explicit, deterministic gates enforce scope, and final signoff remains evidence-backed.

# 3. Task-to-workflow mapping (one concrete example)
User task: "Repair an Agent Relay workflow artifact for Ricky after a failed run."
- Diagnosis and launch hardening: `read-skill-manifest-and-router-state` -> `runtime-and-resume-gate` -> `emit-minimal-plan-and-mapping`.
- Resume point for failed attempt: `implement-v0-5-slice` (with `--start-from implement-v0-5-slice --previous-run-id 8703892316407f6a41ed936c`).
- Recovery loop: `validate-v0-5-first-pass` -> `repair-v0-5-from-evidence` -> `hard-validate-v0-5`, then repeat pattern for v0.6/v0.7.
- Completion proof: `final-hard-validation-and-diff-gate` -> `review-and-final-signoff` -> `final-contract-gate`.

# 4. Integration test notes
- Validate the plan gate markers and implementation note markers using deterministic `rg -q` checks only (no noisy marker line dumps).
- Keep `npm run build -w @agent-assistant/harness` and `npm test -w @agent-assistant/harness` as hard acceptance checks after each repair loop.
- Confirm the final diff gate still requires non-transient repo changes and expected harness file touchpoints.
- Resume test: rerun with `--start-from implement-v0-5-slice --previous-run-id 8703892316407f6a41ed936c` and verify the workflow continues from that step without re-running earlier gates.

RICKY_PLAN_READY
ROUTER_WIRING_COMPATIBLE
