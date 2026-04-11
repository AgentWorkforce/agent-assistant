# Spec Reconciliation Review Verdict

Date: 2026-04-11  
Reviewer: non-interactive reviewer agent  
Verdict: PASS_WITH_FOLLOWUPS

## Summary

The reconciliation pass is materially successful. The planning docs now mostly align to the reconciled v1 specs, the Sage/MSD/NightCTO examples are implementation-credible, and the weekend workflow backlog is trustworthy enough to execute.

The remaining issue is narrow but real: the surfaces spec still reintroduces one retired interface name in its first implementation slice, so the claim that stale API names are fully gone is not yet literally true.

## Assessment

### 1. Are stale API names gone?

Mostly yes, but not completely.

What is clean:
- The planning docs use `AssistantDefinition`, `AssistantRuntime`, `runtime.dispatch()`, `createSurfaceRegistry()`, `SurfaceConnection`, `sessionStore.touch()`, and `sessionStore.expire()` consistently in their active guidance.
- The workflow backlog reflects the reconciled session states and routing rules: [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:43), [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:193), [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:274).

What remains:
- [docs/specs/v1-surfaces-spec.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/specs/v1-surfaces-spec.md:468) still says `Implement receiveRaw + setInboundHandler`, even though the same spec already says `setInboundHandler()` is retired in favor of `onMessage()` / `offMessage()` at [docs/specs/v1-surfaces-spec.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/specs/v1-surfaces-spec.md:299).
- [docs/specs/v1-sessions-spec.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/specs/v1-sessions-spec.md:17) still uses the narrative term `resumption` in responsibilities. That is not an API identifier, but it weakens the “all stale naming is gone” claim.

Conclusion: stale API names are gone from the active planning flow, but not fully eradicated from the reconciled spec set.

### 2. Do the planning docs now match the specs?

Yes, with one minor caveat.

Strong alignment:
- The program plan records all three contradiction resolutions correctly, including `InboundMessage.userId`, optional `OutboundEvent.surfaceId`, and surfaces-owned normalization: [docs/architecture/spec-program-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/spec-program-plan.md:108).
- The sectioning/priorities doc reflects the same reconciled ownership and routing model: [docs/architecture/v1-sectioning-and-priorities.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sectioning-and-priorities.md:37), [docs/architecture/v1-sectioning-and-priorities.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/architecture/v1-sectioning-and-priorities.md:77).
- The workflow backlog now uses the reconciled assembly pattern, explicit `userId` dependency, and targeted-send vs fanout rule: [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:172), [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:193), [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:241).

Minor caveat:
- The planning docs repeatedly state that all eight reconciliation actions are complete and that `setInboundHandler` is retired, but the surfaces spec still contains that retired name in its implementation slice. That makes the “fully complete” status slightly overstated.

Conclusion: planning docs now match the specs well enough for implementation, but one status claim should be softened or the stray spec line should be corrected immediately.

### 3. Are Sage/MSD/NightCTO examples implementation-credible now?

Yes.

Why:
- All three examples use the reconciled imports and assembly pattern: `createAssistant(...)`, `createSessionStore(...)`, `createSurfaceRegistry()`, and `runtime.register("sessions", ...)`: [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:128), [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:217), [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:309).
- MSD and NightCTO correctly attach the originating surface before any future session fanout: [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:237), [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:330).
- The MSD example explicitly distinguishes targeted send from session fanout using the reconciled `OutboundEvent` contract: [docs/workflows/weekend-delivery-plan.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/weekend-delivery-plan.md:241).
- The consumer guide now points products to these patterns instead of the stale API vocabulary: [docs/consumer/how-to-build-an-assistant.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-to-build-an-assistant.md:105), [docs/consumer/how-to-build-an-assistant.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/consumer/how-to-build-an-assistant.md:119).

Limits:
- They are still illustrative snippets, not copy-paste runnable examples, because stub adapters and some helper exports remain hypothetical until implementation lands. That is acceptable for planning docs.

Conclusion: the examples are now credible implementation targets.

### 4. Is the weekend workflow backlog now trustworthy?

Yes.

Why:
- WF-1 through WF-7 now follow the reconciled vocabulary and cross-package ownership model.
- WF-5 clearly assigns inbound normalization to surfaces and depends on normalized `InboundMessage`: [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:195).
- WF-6 correctly describes fanout ownership and the runtime/session/surfaces interaction needed for `sessionId`-only outbound events: [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:248).
- WF-7 no longer uses the stale “session resumed” phrasing and now says `reactivated via touch`: [docs/workflows/v1-workflow-backlog.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/workflows/v1-workflow-backlog.md:292).

Residual caution:
- Because the surfaces spec still has one stale implementation-slice step, a team implementing strictly from that spec section could momentarily recreate the retired inbound interface. The backlog itself is sound; the issue is the stray spec line.

Conclusion: the backlog is trustworthy for execution.

### 5. What follow-ups remain?

Required follow-ups:
1. Update [docs/specs/v1-surfaces-spec.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/specs/v1-surfaces-spec.md:468) so Step 4 says `receiveRaw` + `onMessage`/`offMessage`, not `setInboundHandler`.
2. Clean the narrative wording in [docs/specs/v1-sessions-spec.md](/Users/khaliqgant/Projects/AgentWorkforce/relay-agent-assistant/docs/specs/v1-sessions-spec.md:17) so it does not reintroduce old state vocabulary via `resumption`.
3. After those edits, downgrade the “all eight checklist actions are complete” risk by rerunning a narrow stale-term sweep over the reconciled docs and confirming the result in this verdict file or a successor review.

Optional follow-up:
1. If the repo wants stricter enforcement, add a doc lint/check for the retired terms listed in `docs/architecture/spec-reconciliation-rules.md`.

## Final Verdict

PASS_WITH_FOLLOWUPS

The reconciled docs are substantially correct and implementation-usable. The remaining gap is a narrow spec hygiene issue, not a planning-architecture failure, but it is enough that a full PASS would overstate the current state.

Artifact produced:
- `docs/architecture/spec-reconciliation-review-verdict.md`

SPEC_RECONCILIATION_REVIEW_COMPLETE
