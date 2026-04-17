# V1 Sage Specialist Adoption Map

Date: 2026-04-16

## Purpose

This document turns the specialist-delegation boundary into a Sage-first adoption map. It defines the proving order, the narrowest viable implementation slice, and the exact boundary between Sage-owned proving work and reusable Agent Assistant substrate work.

The intent is to prove that specialist delegation improves investigation quality before expanding the abstraction surface.

---

## Adoption Sequence

The proving sequence for v1 is intentionally sequential:

1. **Boundary/spec complete**
   - Freeze the v1 contracts in the four boundary docs.
   - Treat `DelegationRequest`, `SpecialistFindings`, `EvidenceItem`, `DelegationTransport`, and RelayFile evidence paths as the only required reusable surface.
   - Do not add new generic orchestration concepts until Sage proving exposes a real need.

2. **Sage proving implementation**
   - Implement one Sage-owned GitHub Investigation Specialist agent.
   - Wire one coordinator-to-specialist request/response path over Relay.
   - Persist durable evidence under `/evidence/{assistantId}/{requestId}/...`.
   - Use the specialist only for a bounded investigation slice that can be compared against Sage’s current inline path.

3. **Agent Assistant reusable substrate implementation**
   - Extract only the pieces that Sage proved necessary:
   - coordination types for request/findings/evidence
   - turn-context projection helpers
   - a transport interface with an in-memory test transport
   - compatibility projection from findings back into current result shapes
   - Keep Relay SDK wiring and RelayFile client code outside the shared substrate.

4. **Sage re-adoption against shared substrate**
   - Replace Sage-local proving types and adapters with the shared Agent Assistant substrate.
   - Re-run the same proving scenarios to confirm no grounding or evidence regressions.
   - Only then expand to additional capabilities or additional products.

---

## Narrowest Viable Sage Slice

### Goal

Improve investigation quality immediately without overcommitting the architecture.

### Slice definition

The proving slice is:

- one coordinator
- one GitHub Investigation Specialist
- one request
- one findings response
- one Relay thread correlation key (`requestId`)
- optional RelayFile durable artifacts
- no lateral delegation
- no fan-out
- no general specialist marketplace

### Supported user-facing tasks

Sage should first route only these high-value investigation prompts through the specialist:

- "Investigate PR #N"
- "Investigate issue #N"
- "Read this PR and tell me the main risks"
- "Summarize what changed and what is still unclear"

This slice should prefer `pr_investigation` first, with `issue_investigation` as the second proving target only if the PR path is stable.

### Why this slice is narrow enough

- It exercises the full contract: request, relay transport, findings, evidence, enrichment, synthesis.
- It targets an area where Sage’s current inline text-blob execution is weakest: preserving structured findings and provenance.
- It avoids broad migration of simple file reads or code search before the core boundary is proven.

---

## Ownership Map

### Boundary/spec layer

Owned by architecture docs and future shared coordination types:

- `DelegationRequest`
- `SpecialistFindings`
- `EvidenceItem`
- evidence kind taxonomy
- `DelegationTransport`
- `EvidenceWriter` interface
- evidence-to-enrichment projection rules

### Sage proving layer

Owned by Sage and intentionally product-specific:

- when Sage decides to delegate
- specialist prompt and model choice
- Relay agent names and channel topology
- GitHub VFS-first read logic and API fallback behavior
- clone-request behavior for cache warming
- answer synthesis policy from findings
- rollout and fallback to the current inline path

### Shared substrate layer

Owned by Agent Assistant only after Sage proves the need:

- reusable TypeScript types
- request/findings validation utilities
- transport and projection interfaces
- in-memory proving harnesses

The shared substrate must not own:

- Sage routing heuristics
- Sage answer style
- GitHub product policy
- direct Relay SDK clients
- direct RelayFile SDK clients

---

## Immediate Follow-Up Workflow Map

### Workflow 1: Sage proving implementation

Build the smallest end-to-end path with:

- a coordinator-side delegation decision for `pr_investigation`
- a Relay-backed request/response transport
- a Sage GitHub specialist agent
- structured findings with at least:
  - one `pr_summary`
  - one `diff_analysis`
  - optional durable artifact for large diff/report content
- turn-context enrichment projection into synthesis
- fallback to the existing inline path when the specialist fails

### Workflow 2: Proof harness and validation

Build fixtures and checks for:

- request payload shape
- findings payload shape
- RelayFile evidence manifest shape
- grounding quality in final answers and follow-up plans

### Workflow 3: Shared substrate extraction

After Sage proving passes, extract:

- coordination types
- validators
- enrichment projection helpers
- in-memory transport
- compatibility adapters

### Workflow 4: Sage re-adoption

Replace Sage-local proof scaffolding with the shared substrate and verify:

- same or better answer grounding
- same or better investigation completeness
- no product-policy leakage into Agent Assistant

---

## Readiness Gates Between Phases

### Gate A: boundary to Sage proving

Proceed only when:

- the four boundary docs are accepted as the v1 contract source
- the narrow Sage slice is fixed to `pr_investigation` first
- no additional generic abstractions are being added to unblock proving

### Gate B: Sage proving to shared substrate extraction

Proceed only when:

- Sage can complete at least one end-to-end PR investigation through the specialist path
- findings contain structured evidence with source provenance
- final answers are observably better grounded than the inline text-blob path
- any missing shared helpers are concrete and repeated, not speculative

### Gate C: shared substrate extraction to Sage re-adoption

Proceed only when:

- the shared substrate contains only Sage-proven abstractions
- Sage can delete or simplify local proving code by adopting the substrate
- the same proof scenarios pass after re-adoption

---

## Explicit v1 Non-Goals

Do not do these in v1:

- build a generic multi-specialist orchestration engine
- support parallel fan-out or lateral delegation
- migrate every GitHub capability at once
- move Sage routing logic into Agent Assistant
- move GitHub specialist behavior into generic SDK packages
- make specialists behave like assistants with traits, sessions, or surfaces
- treat ephemeral status messages as evidence
- require durable evidence for every investigation

---

## Success Criteria

The Sage-first adoption is successful when all of the following are true:

- Sage can delegate a PR investigation to a Relay-native specialist and receive structured findings.
- Evidence is preserved with provenance and optional durable artifacts instead of being flattened into tool-result text blobs.
- Sage produces better grounded answers or plans for PR investigation than the current inline path.
- The shared Agent Assistant substrate extracted afterward is smaller than what a priori architecture would have produced.

---

V1_SAGE_SPECIALIST_ADOPTION_MAP_READY
