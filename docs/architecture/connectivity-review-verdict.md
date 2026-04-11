# Connectivity Package Spike — Review Verdict

Date: 2026-04-11
Verdict: **PASS_WITH_FOLLOWUPS**

---

## Files Reviewed

- `packages/connectivity/README.md`
- `docs/architecture/connectivity-package-spec.md`
- `docs/consumer/connectivity-adoption-guide.md`
- `docs/research/connectivity-patterns.md`
- `README.md`
- `docs/index.md`

---

## Assessment

### 1. Is connectivity clearly distinct from coordination and transport?

**Yes. The distinctions are crisp and well-anchored.**

The spec draws three explicit boundaries:

- **vs coordination**: "Coordination owns who is doing what. Connectivity owns what minimal signals move between those participants while work is in progress."
- **vs routing**: "Routing chooses the operating envelope. Connectivity adapts internal communication policy inside that envelope."
- **vs transport**: "Relay transport answers how something is delivered. Connectivity answers why a signal exists, who should receive it, how urgent it is, and when it can be dropped."

Each distinction is stated with concrete examples on both sides. There is no meaningful overlap or ambiguity in what each package owns. The layering model — transport below, routing alongside, coordination alongside, product specialists above — is internally consistent across the README, spec, adoption guide, and research doc.

The only area that could use sharper treatment is the API surface between connectivity and coordination. The spec says connectivity sits "beside" coordination but does not define the call direction. Does coordination call into connectivity to emit signals? Does connectivity call coordination to resolve conflicts? That interaction boundary needs a sentence in the spec before implementation begins.

---

### 2. Is the neural-style framing practical rather than fluffy?

**Yes. The vocabulary is grounded, not decorative.**

The five message classes — attention, confidence, conflict, handoff, escalation — could sound abstract in isolation. They are not abstract here. Every class has concrete product examples immediately attached:

- attention: "memory lookup finds high-salience context"
- confidence: "high confidence: ready for synthesis / blocker uncertainty: do not finalize yet"
- conflict: "memory says one thing, live evidence says another"
- handoff: "partial result ready / blocked pending more scope"
- escalation: "policy risk / deadline risk / invalid plan"

The focused-coordination-vs-generic-chatter distinction is not cosmetic framing. It is actionable design guidance: narrowcast over broadcast, delta over transcript, explicit urgency over inferred urgency. The adoption guide translates this into concrete behavioral before/after comparisons that a product team can act on directly.

The TypeScript `ConnectivitySignal` type in the spec grounds the conceptual model in a real artifact. The combination of vocabulary + examples + type definition is enough for an engineer to understand what a signal is and what it is not.

No concerns with fluffy framing here.

---

### 3. Is the package useful for Sage, MSD, and NightCTO specifically?

**Yes. The fit is differentiated per product, not generic.**

Each product has a dedicated usage section in the README, spec, adoption guide, and research doc, and the guidance is meaningfully different for each:

**Sage** — the primary coordination need is memory-to-synthesis attention and proactive-to-synthesis handoff without over-notifying. The recommended first workflows are correctly scoped: emit attention only when retrieved context materially changes interpretation, emit handoff.blocked instead of interrupting with speculative follow-up.

**MSD** — the primary need is structured review feedback that does not become free-form internal chat. The conflict-detection and handoff-ready patterns map cleanly to reviewer-to-planner and planner-to-composer flows. The guidance that notifiers subscribe only to terminal or escalation-grade signals is specific and correct.

**NightCTO** — the primary challenge is many-specialist coordination under one identity. The research doc correctly identifies consensus compression as the dominant pattern for NightCTO that the other two products need less. The guidance that specialists narrowcast to coordinator by default and that urgency interrupts without waiting for the next synthesis cycle directly addresses the coordination failure mode specific to many-specialist operation.

The product sections avoid being generic rewrites of each other. Each one describes a real coordination problem and maps it to specific signal classes.

---

### 4. Are the docs detailed enough to become implementation specs next?

**Mostly yes. The conceptual foundation is complete. Several concrete decisions need to be locked before code is written.**

What is already spec-ready:

- the five message classes and illustrative signal subtypes
- the `ConnectivitySignal` type shape (noted as illustrative but well-formed)
- the four audience semantics (`self`, `coordinator`, `selected`, `all`) with a clear default recommendation
- the four workflow shapes (narrowcast, escalation, conflict, handoff) with step-by-step outlines
- the routing-mode policy matrix (cheap / fast / deep) with the non-negotiable fixed-quality-bar rule
- the staged implementation plan (types → policy helpers → dispatcher → workflow examples → tests)

What needs to be decided before writing implementation specs:

1. **Signal lifecycle** — the spec defines fields but not the state machine. What are the valid states (emitted → active → superseded → expired)? What triggers each transition? This is needed before suppression and replacement rules can be implemented.

2. **Suppression and replacement semantics** — the spec lists `replaces` as a field and mentions suppression windows but leaves both undefined. The open questions section asks "whether signal replacement should be explicit or inferred" and "what the default suppression window should be." These must be answered in the spec before code is written.

3. **`selected` audience resolution** — how does a sender specify the selected subset? By component name? By role? By capability tag? The spec defines the audience value but not the mechanism for declaring who is in the selection.

4. **Route-escalation hint contract** — the spec says connectivity should be able to request a deeper route when confidence is too low, but does not define the interface between connectivity and `@relay-assistant/routing`. This is a cross-package contract that needs to be defined jointly.

5. **Error handling** — what happens when a signal cannot be routed? When coordinator is unreachable? When a handoff.ready arrives but the downstream component has already finalized? Silence is not a safe default.

6. **Observability boundary** — what signal metadata belongs in OSS logging vs cloud-only pipelines? This affects what fields go in the base type vs adapter extensions.

---

### 5. What is still missing before this package is ready to move into specs/workflows/code?

**Six specific gaps, ordered by blocking risk:**

#### Gap 1: Signal lifecycle state machine (blocks suppression and replacement implementation)

The `replaces` field exists but the rules for when replacement is allowed, required, or forbidden are not defined. Define the lifecycle:

```
emitted → active → [superseded | expired | resolved]
```

Include: who can supersede a signal, what happens to downstream listeners that already consumed the original, whether coordinators must be notified of supersession.

#### Gap 2: Suppression window definition (blocks efficiency implementation)

The spec mentions suppressing repeated low-value signals "within a short window" but does not define the window. Before the first spec is written, define:

- the default suppression window for low-priority signals
- whether the window is step-based, time-based, or token-budget-based
- whether suppression can be overridden per signal class

#### Gap 3: `selected` audience resolution mechanism (blocks narrowcast implementation)

The spec defines the `selected` audience value but not how a sender identifies who is in the selection. This needs a concrete answer. Options to evaluate: named component IDs, capability tags, coordinator-managed role lists. Pick one for the first spec.

#### Gap 4: Connectivity-to-routing escalation interface (blocks route-escalation workflow)

The route-escalation hint workflow appears in the spec and adoption guide but the interface with `@relay-assistant/routing` is undefined. This is a cross-package contract. Before the escalation workflow spec is written, the routing package owner and the connectivity spec need to agree on:

- what signal or hook connectivity emits
- how routing receives and processes it
- what feedback, if any, routing sends back

#### Gap 5: Coordination-connectivity interaction boundary (blocks integration with coordination package)

The spec says connectivity sits "beside" coordination but does not define the call direction or contract. Does coordination invoke connectivity to emit signals? Does connectivity surface conflict signals to coordination for resolution? A single diagram or table of owned interfaces would close this gap.

#### Gap 6: First four concrete workflow specs (prerequisite for workflow stage)

The spec identifies the four first workflows:
1. narrowcast attention
2. reviewer conflict escalation
3. specialist handoff ready
4. blocker uncertainty requesting deeper routing

These are named but not yet written as workflow specs. The gap here is not that the workflows are wrong — they are the right four — but that each needs to be written as a full step-by-step spec with signal types, audience choices, error conditions, and expected coordinator behavior before any implementation begins.

---

## Summary

The connectivity package spike is well-conceived and internally consistent. The conceptual foundation — message classes, signal envelope, routing-mode policy, focused-coordination-vs-chatter — is sound and can move into implementation specs without rethinking the design. The product fit for Sage, MSD, and NightCTO is specific and differentiated. The framing is practical.

The six gaps above are not design problems. They are decisions that the spike correctly deferred to the spec stage but that must be made before the spec can be called complete. None of them require revisiting the core thesis.

Recommended next steps:

1. Write the signal lifecycle state machine as a section addition to the existing spec.
2. Define suppression window and replacement semantics as a named subsection.
3. Resolve the `selected` audience mechanism with the coordination package owner.
4. Define the connectivity-to-routing escalation interface jointly with the routing package owner.
5. Write the four first workflow specs as separate documents under `docs/workflows/`.
6. Update `docs/index.md` to reference the workflow specs when they exist.

---

CONNECTIVITY_REVIEW_COMPLETE
