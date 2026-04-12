# Connectivity Signal Catalog

**Status:** IMPLEMENTATION_READY
**Date:** 2026-04-11
**Spec reference:** `docs/specs/v1-connectivity-spec.md` (V1_CONNECTIVITY_SPEC_READY)

This catalog is the authoritative reference for all signal classes defined in `@agent-assistant/connectivity` v1. Each entry specifies: semantics, required and optional fields, valid audience values, expected `priority` range, convergence responsibilities, and anti-patterns.

---

## Vocabulary Summary

| Signal class | Message class | Priority default | `confidence` required | Typical audience |
|---|---|---|---|---|
| `attention.raise` | attention | `normal` | No | `coordinator`, `selected` |
| `confidence.high` | confidence | `normal` | **Yes** (0.8–1.0) | `coordinator` |
| `confidence.medium` | confidence | `normal` | **Yes** (0.4–0.79) | `coordinator` |
| `confidence.low` | confidence | `high` | **Yes** (0.1–0.39) | `coordinator` |
| `confidence.blocker` | confidence | `high` | **Yes** (0.0) | `coordinator` |
| `conflict.active` | conflict | `high` | **Yes** (any 0.0–1.0) | `coordinator` |
| `conflict.resolved` | conflict | `normal` | **Yes** (from source signal) | `coordinator` |
| `handoff.ready` | handoff | `normal` | No | `selected`, `coordinator` |
| `handoff.partial` | handoff | `normal` | No | `selected`, `coordinator` |
| `escalation.interrupt` | escalation | `critical` | No | `coordinator`, `all` |
| `escalation.uncertainty` | escalation | `high` | No | `coordinator` |

---

## 1. `attention.raise`

**Message class:** `attention`

### Semantic

A component has observed something that may change how another component should interpret the current context or proceed with its work. The signal does not demand immediate action; it raises the salience of a piece of information for the recipient.

### When to use

- Memory retrieves context that shifts the likely intent of a user request
- A supporting specialist notices a constraint that the primary specialist may not have considered
- A reviewer sees a background fact that contradicts an assumption in the current draft

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'attention'` |
| `signalClass` | `'attention.raise'` |
| `summary` | One sentence describing what changed and why it matters |

### Optional fields

| Field | Guidance |
|---|---|
| `confidence` | Omit unless you have a meaningful salience score to express |
| `details` | Include the specific context fragment if it is compact (<500 chars) |
| `expiresAtStep` | Set if the context is step-specific and will be stale by next synthesis |
| `replaces` | Set if this supersedes an earlier `attention.raise` from the same source |

### Audience guidance

- `coordinator` — when the coordinator should weigh this before synthesis
- `selected` — when a specific downstream specialist should consider this before producing output; requires `SelectedAudienceResolver`

### Priority guidance

Default: `normal`. Escalate to `high` only if the attention signal indicates a potential safety or policy issue that should interrupt current work. Do not use `critical`.

### Convergence responsibility

Coordination resolves `attention.raise` signals after synthesis consumes them or after they expire. Emitters should set `expiresAtStep` when possible to enable auto-expiry.

### Anti-patterns

- Do not emit `attention.raise` every time memory retrieves any context; emit only when the context changes the likely answer
- Do not use `attention.raise` to broadcast reasoning transcripts; use `details` compactly
- Do not emit with `audience='all'` unless every active specialist will change behavior based on this signal

---

## 2. `confidence.high`

**Message class:** `confidence`

### Semantic

The emitting specialist's current output is stable, well-supported, and ready for synthesis. The coordinator can treat this output as reliable input.

### When to use

- A specialist has completed its assigned subtask with high certainty
- Evidence for the conclusion is strong and consistent
- No conflicting signals remain unresolved for this source

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.high'` |
| `confidence` | 0.8–1.0 |
| `summary` | What was concluded and why confidence is high |

### Audience guidance

`coordinator` only. Confidence signals are coordination inputs; they are not narrowcast to other specialists.

### Priority guidance

Default: `normal`. Do not use `high` or `critical` for confidence signals; high confidence does not require interruption.

### Convergence responsibility

Coordination resolves `confidence.*` signals once synthesis has consumed the output. Do not leave confidence signals unresolved across multiple steps.

### Supersession

When a specialist's confidence changes from a prior signal, emit the new confidence level with `replaces` pointing to the prior confidence signal. Do not emit a second confidence signal for the same step without superseding the first.

---

## 3. `confidence.medium`

**Message class:** `confidence`

### Semantic

The emitting specialist's output is reasonable but carries caveats. The coordinator should synthesize this output but may want to flag the caveats to the user or request a deeper review.

### When to use

- Evidence is consistent but not exhaustive
- The specialist completed work but under partial information
- There is one unresolved background assumption that does not block synthesis

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.medium'` |
| `confidence` | 0.4–0.79 |
| `summary` | The conclusion and what caveat reduces confidence |

### Priority guidance

Default: `normal`. Use `high` if the caveat concerns a policy-sensitive area.

### Anti-patterns

- Do not use `confidence.medium` as a default when you have not assessed confidence; use it only when you have a specific reason for the caveat
- Do not emit `confidence.medium` and `confidence.low` simultaneously from the same source

---

## 4. `confidence.low`

**Message class:** `confidence`

### Semantic

The emitting specialist's output is speculative or weakly supported. The coordinator should consider whether to use this output at all, re-delegate to a more capable routing mode, or hold synthesis pending additional input.

### When to use

- The specialist completed the task but with significant uncertainty
- Evidence is contradictory or sparse
- The result depends heavily on an assumption the specialist cannot verify

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.low'` |
| `confidence` | 0.1–0.39 |
| `summary` | What makes confidence low; what would increase it |

### Priority guidance

Default: `high`. Low confidence output affects synthesis quality; the coordinator should be alerted promptly.

### Convergence responsibility

Coordination should either re-delegate this subtask in a deeper routing mode, request more input, or explicitly decide to proceed with the low-confidence output. If re-delegating, resolve the `confidence.low` signal after the new specialist emits.

---

## 5. `confidence.blocker`

**Message class:** `confidence`

### Semantic

The emitting specialist cannot produce useful output without additional input, clarification, or a routing mode change. Synthesis should not proceed for this specialist's subtask until the blocker is resolved.

### When to use

- The specialist lacks a required piece of information
- The task cannot be completed under the current routing mode's constraints
- A dependency on another specialist's output has not been satisfied

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'confidence'` |
| `signalClass` | `'confidence.blocker'` |
| `confidence` | 0.0 (exactly) |
| `summary` | What is missing; what would unblock |

### Priority guidance

Default: `high`. If the blocker involves a policy issue or would corrupt final output, use `critical`.

### Convergence responsibility

The coordinator must act on `confidence.blocker` before synthesis. Options: request more information, re-route to a deeper mode, substitute an alternative specialist, or communicate the limitation to the user. After resolution, emit a superseding `confidence.*` signal with `replaces` pointing to the blocker.

### Anti-patterns

- Do not emit `confidence.blocker` speculatively as a first response; attempt the task and only emit if genuinely blocked
- Do not leave `confidence.blocker` unresolved across multiple steps without coordination action

---

## 6. `conflict.active`

**Message class:** `conflict`

### Semantic

The emitting component has identified a disagreement between two active views or outputs that affects the final answer. The conflict is unresolved and requires coordination action before synthesis can proceed.

### When to use

- A reviewer finds that the current draft contradicts a verified fact
- Two specialists have produced outputs that cannot both be correct
- Memory context contradicts a live evidence conclusion

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'conflict'` |
| `signalClass` | `'conflict.active'` |
| `confidence` | The emitter's confidence that the conflict is real (0.0–1.0) |
| `summary` | What the two conflicting views are; which sources hold each view |

### Optional fields

| Field | Guidance |
|---|---|
| `details` | Compact evidence supporting the conflict claim |
| `priority` | `high` is standard; `critical` if the conflict would produce incorrect or unsafe output |

### Priority guidance

Default: `high`. Do not use `low` or `normal` for unresolved conflicts.

### Convergence responsibility

Coordination must arbitrate or re-route when `conflict.active` signals are present. After resolution, emit `conflict.resolved` and call `resolve()` on each `conflict.active` signal. Synthesis should not proceed while `conflict.active` signals remain in `active` state.

### Multiple conflicts

Multiple `conflict.active` signals from different sources are normal. Coordination's `query()` for `messageClass='conflict', state=['emitted','active']` retrieves all open conflicts at once.

---

## 7. `conflict.resolved`

**Message class:** `conflict`

### Semantic

A previously flagged conflict has been arbitrated or dissolved. The emitter is declaring that the conflict is no longer blocking synthesis.

### When to use

- After coordination arbitrates between conflicting views and a winner is determined
- After re-routing to a deeper mode produces a consistent answer
- After new information dissolves the conflict

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'conflict'` |
| `signalClass` | `'conflict.resolved'` |
| `confidence` | Confidence that the resolution is correct (carry forward from the winning signal or set explicitly) |
| `summary` | How the conflict was resolved |

### Convergence responsibility

After emitting `conflict.resolved`, coordination should call `resolve()` on all related `conflict.active` signals. The `conflict.resolved` signal itself should be resolved after synthesis consumes it.

---

## 8. `handoff.ready`

**Message class:** `handoff`

### Semantic

The emitting specialist has completed its work for the current step. Its output is ready for downstream consumption. The downstream component can proceed without polling.

### When to use

- A planner finishes a plan and hands it to reviewers
- A reviewer completes its pass and hands findings to the synthesis component
- Memory enrichment is complete and the enriched context is available

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'handoff'` |
| `signalClass` | `'handoff.ready'` |
| `summary` | What output is ready and where it can be accessed |

### Audience guidance

- `selected` — when a specific downstream component should begin processing
- `coordinator` — when the coordinator decides who processes next

### Supersession

When a `handoff.partial` was emitted earlier, emit `handoff.ready` with `replaces` pointing to the partial signal. The coordinator and downstream components treat the ready signal as superseding the partial.

### Convergence responsibility

The consuming component (or coordination on its behalf) resolves `handoff.ready` after consuming the output. Do not leave handoff signals open indefinitely.

---

## 9. `handoff.partial`

**Message class:** `handoff`

### Semantic

The emitting specialist has produced partial output. A downstream component may begin processing available output, but should expect more. Do not finalize until `handoff.ready` supersedes this signal.

### When to use

- A specialist is streaming or batching results and the first batch is available
- The partial output is useful for parallel processing but not final
- Early partial output reduces end-to-end latency for the downstream component

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'handoff'` |
| `signalClass` | `'handoff.partial'` |
| `summary` | What partial output is available; what is still pending |

### Convergence responsibility

The emitter must follow up with either `handoff.ready` (with `replaces`) or `confidence.blocker` (if the partial cannot be completed). A `handoff.partial` that is never superseded or resolved is a convergence failure.

---

## 10. `escalation.interrupt`

**Message class:** `escalation`

### Semantic

The current execution path must stop immediately. Something has been discovered that makes continuing unsafe, incorrect, or wasteful. Coordination must change the plan before proceeding.

### When to use

- A policy gate detects a safety or compliance violation in the planned action
- An invalid plan is discovered mid-execution
- An action would cause an irreversible and harmful side effect
- A strict deadline has been violated and proceeding is wasteful

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'escalation'` |
| `signalClass` | `'escalation.interrupt'` |
| `summary` | Why the path must stop; what specifically triggered the interrupt |
| `priority` | `'critical'` (default and recommended) |

### Routing hook behavior

When `escalation.interrupt` is emitted, the registered `RoutingEscalationHook.onEscalation()` is called synchronously. Routing may change its mode in response. Connectivity does not know or care about the returned mode.

### Suppression behavior

`priority='critical'` signals are never suppressed. Every `escalation.interrupt` is stored and fires callbacks.

### Convergence responsibility

Coordination must acknowledge and act on every `escalation.interrupt`. Acceptable actions: halt and re-plan, halt and inform the user, or route to a deeper mode for safety review. After the path has changed, coordination resolves the signal.

### Anti-patterns

- Do not use `escalation.interrupt` for soft quality concerns; use `confidence.low` or `confidence.blocker` instead
- Do not emit `escalation.interrupt` and continue execution as if nothing happened; coordination must change the path

---

## 11. `escalation.uncertainty`

**Message class:** `escalation`

### Semantic

The emitting specialist cannot produce an answer that meets the quality bar under the current routing mode. The specialist is requesting that routing escalate to a deeper mode. This is not a stop; it is a request.

### When to use

- The current `cheap` or `fast` mode cannot provide a sufficiently confident answer
- The task requires more context or reasoning capacity than the current mode allows
- A `confidence.blocker` has been emitted and the resolution requires a deeper model

### Required fields

| Field | Value |
|---|---|
| `messageClass` | `'escalation'` |
| `signalClass` | `'escalation.uncertainty'` |
| `summary` | Why the current mode is insufficient; what deeper mode would address |
| `priority` | `'high'` (default and recommended) |

### Routing hook behavior

When `escalation.uncertainty` is emitted, `RoutingEscalationHook.onEscalation()` is called synchronously. Routing may return `'deep'` or another mode. Coordination reads the signal via `onSignal` and decides whether to re-delegate under the new mode.

### Distinction from `escalation.interrupt`

| | `escalation.interrupt` | `escalation.uncertainty` |
|---|---|---|
| Stop current path? | Yes, immediately | No, request escalation |
| Priority | `critical` | `high` |
| Coordinator action | Must change plan | Should consider re-routing |
| Routing hook response | Typically `'deep'` | Typically `'deep'` or `'fast'` |

### Convergence responsibility

Coordination decides whether to honor the escalation request or proceed with the current mode. If re-routing, resolve the `escalation.uncertainty` signal after the new routing decision is made. If not re-routing, resolve the signal with a note in the resolved state.

---

## Cross-Cutting Rules

### Confidence field across message classes

| Scenario | `confidence` field |
|---|---|
| `confidence.*` signal | **Required.** Strict range per signal class. |
| `conflict.*` signal | **Required.** Reflects emitter's certainty that the conflict is real. |
| `attention.raise` | Optional. Omit unless you have a meaningful value. |
| `handoff.*` | Optional. Not typically used. |
| `escalation.*` | Optional. Not typically used. |

### Priority defaults by message class

| Message class | Default priority |
|---|---|
| `attention` | `normal` |
| `confidence` | `normal` (except `confidence.low` and `confidence.blocker`: `high`) |
| `conflict` | `high` |
| `handoff` | `normal` |
| `escalation` | `high` (except `escalation.interrupt`: `critical`) |

### `audience='all'` guidance

Use `audience='all'` only for `escalation.interrupt` at `priority='critical'`. All other signal classes should use `coordinator` or `selected`. Broadcast signals increase coordination noise and suppress less aggressively.

### Supersession (using `replaces`)

| Signal class | When to supersede |
|---|---|
| `confidence.*` | When confidence grade changes; supersede prior confidence from same source |
| `handoff.partial` | When `handoff.ready` is emitted for the same work |
| `attention.raise` | When a newer observation replaces the prior one from the same source |
| `conflict.active` | Do not supersede; emit `conflict.resolved` and call `resolve()` instead |
| `escalation.*` | Do not supersede; escalations must be acknowledged before resolving |

### Resolution order

1. Coordination or downstream component consumes the signal
2. Call `resolve(signalId)` on the consumed signal
3. Do not leave non-terminal signals open across multiple steps unless intentional

---

*For the full type definitions, see `docs/specs/v1-connectivity-spec.md`.*
*For implementation guidance, see `docs/architecture/v1-connectivity-implementation-plan.md`.*
