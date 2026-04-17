# V1 Specialist Delegation No-Shortcuts Checklist

Date: 2026-04-16

## Purpose

This checklist is the v1 guardrail against fake progress. It makes explicit what not to do while implementing specialist delegation so that Sage proving stays narrow and Agent Assistant remains reusable for the right reasons.

Use this document as a release gate for follow-up workflows.

---

## No-Shortcuts Rules

### Boundary discipline

- Do not add new shared abstractions before the Sage proving slice proves they are necessary.
- Do not let `@agent-assistant/*` packages import `@agent-relay/sdk` or `@relayfile/sdk` directly for this work.
- Do not put Sage routing heuristics, synthesis prompts, or GitHub policy into Agent Assistant shared packages.
- Do not treat specialists as assistants with traits, sessions, inboxes, or surfaces.

### Delegation discipline

- Do not implement parallel fan-out in v1.
- Do not implement lateral specialist-to-specialist delegation in v1.
- Do not build a marketplace, registry protocol, or dynamic discovery mechanism for v1.
- Do not turn status pings into evidence.
- Do not accept freeform text blobs as a substitute for `SpecialistFindings`.

### Sage scope discipline

- Do not migrate all existing GitHub operations into the specialist path at once.
- Do not start with `code_search`, `file_read`, and `repo_exploration` if `pr_investigation` is not already proven.
- Do not remove Sage’s current inline fallback until the specialist path passes the proof gates.
- Do not optimize for broad reuse before proving that Sage’s investigation quality actually improves.

### RelayFile discipline

- Do not write durable evidence outside `/evidence/{assistantId}/{requestId}/...`.
- Do not write durable artifacts without a manifest.
- Do not store source-of-truth provider data under `/evidence/...`.
- Do not force every evidence item to be durable when inline content is sufficient.

### Grounding discipline

- Do not let the final answer claim facts that are absent from evidence or gaps.
- Do not hide uncertainty when VFS data is stale, missing, or only partially synced.
- Do not recommend follow-up work that depends on unimplemented v1.1 features unless clearly marked as future work.
- Do not call the proof successful because the transport worked if answer grounding got worse or stayed flat.

---

## Review Checklist

Before marking a specialist-delegation task complete, confirm all items below:

- The proving slice is still bounded to one coordinator and one GitHub specialist.
- The active capability is still `pr_investigation` unless there is explicit evidence that a second capability is needed.
- The request is structured and correlated by `requestId`.
- The findings are structured and include provenance, confidence, summary, gaps, and metadata.
- Any durable evidence follows the RelayFile contract and manifest shape.
- The final Sage answer or plan is grounded in evidence rather than reconstructed from memory or logs.
- Product-specific behavior remains in Sage.
- Shared substrate code contains only abstractions that Sage already proved useful.

---

## Failure Signals

Stop and correct course if any of these appear:

- a proposed shared abstraction exists only to support hypothetical future specialists
- a product implementation is blocked because the team is trying to design v1.1 too early
- the specialist returns verbose natural language but little structured evidence
- the proof harness cannot explain why an answer is considered grounded
- Sage quality is unchanged, but the implementation surface has grown substantially

---

## Decision Rule

When there is tension between "prove the Sage slice now" and "generalize for future products," choose the Sage proof unless the missing generalization is a direct blocker backed by current evidence.

That is the v1 standard for avoiding shortcuts.

---

V1_SPECIALIST_DELEGATION_NO_SHORTCUTS_READY
