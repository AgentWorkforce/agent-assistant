# V1 Specialist Delegation Proof Plan

Date: 2026-04-16

## Purpose

This document defines the proving plan for v1 specialist delegation. It turns the approved architecture boundary into an execution-ready sequence with explicit validation gates for contract shape, RelayFile evidence shape, and grounding quality in Sage’s final answers and plans.

The proving standard is not "messages moved between agents." The proving standard is "Sage investigates better with bounded specialist delegation than with the current inline path."

---

## Proving Objective

Prove one bounded GitHub investigation path end to end:

1. Sage coordinator emits a valid `DelegationRequest`.
2. A Relay-native GitHub specialist executes the investigation.
3. The specialist returns valid `SpecialistFindings` with structured evidence.
4. Optional durable artifacts are written under the RelayFile evidence contract.
5. Sage synthesizes a more grounded answer or plan from those findings.

If any one of these fails, the proof is incomplete.

---

## Proving Sequence

### Phase 0: Boundary freeze

Inputs:

- `v1-specialist-delegation-boundary.md`
- `v1-agent-to-agent-evidence-exchange.md`
- `v1-relayfile-backed-evidence-contract.md`
- `v1-github-investigation-specialist-boundary.md`

Outputs:

- no new architecture surface added without a proving blocker
- one fixed proving slice: `pr_investigation`

### Phase 1: Sage-owned proving path

Implement in Sage:

- delegation decision for bounded PR investigation prompts
- coordinator-side request builder
- Relay-backed transport adapter
- GitHub specialist handler for `pr_investigation`
- findings-to-enrichment projection
- synthesis path that consumes findings
- fallback to current inline investigation path

Proof target:

- a real or fixture-backed PR investigation can run fully through the specialist path

### Phase 2: Validation harness

Implement tests and fixtures around the Sage proving path:

- request contract validation
- findings contract validation
- evidence manifest validation
- answer grounding checks
- fallback behavior checks

Proof target:

- failures are attributable to a gate, not to ambiguous "seems fine" judgment

### Phase 3: Shared substrate extraction

Move only proved abstractions into Agent Assistant:

- shared types
- schema validators
- projection helpers
- transport interface
- in-memory harness for request/response proving

Proof target:

- Sage can swap to the shared substrate without changing product-owned routing or synthesis behavior

### Phase 4: Sage re-adoption

Rewire Sage to use the extracted substrate and rerun proving scenarios.

Proof target:

- the same investigations still pass
- evidence shape remains stable
- grounding quality does not regress

---

## Narrowest Viable Proof Slice

The initial proof slice must be smaller than the eventual product ambition.

### Included

- `pr_investigation`
- one repo at a time
- VFS-first read path
- API fallback only when Sage already has that path available
- at least two evidence items in findings:
  - `pr_summary`
  - `diff_analysis`
- one final answer or action plan grounded in those findings

### Excluded

- code generation
- PR approval/rejection policy
- issue triage policy
- multi-specialist routing
- live debate between agents
- background autonomous specialist loops
- broad conversion of all existing GitHub tools to specialist delegation

---

## Validation Gates

### Gate 1: Specialist request shape

The coordinator request is valid only if all of the following are true:

- `requestId`, `turnId`, `threadId`, and `assistantId` are present
- `parameters.capability === 'pr_investigation'`
- `parameters.repo.owner`, `parameters.repo.repo`, and `parameters.pr.number` are present
- `bounds.timeoutMs` is set
- `bounds.allowDurableEvidence` is explicit
- payload is JSON-serializable and fits the message size expectation
- Relay `threadId` equals `requestId`

Fail the gate if Sage sends ad hoc prompt text without the structured request shape.

### Gate 2: Specialist findings shape

The response is valid only if all of the following are true:

- `requestId` matches the original request
- `specialistName` is present
- `status` is one of `complete`, `partial`, `failed`
- `confidence.score` is in `[0, 1]`
- `summary` is present
- `evidence` is an array of structured `EvidenceItem`s
- each evidence item has `id`, `kind`, `title`, `content`, `confidence`, and `source`
- `metadata.durationMs`, `metadata.actionCount`, `metadata.durableEvidenceCount`, and `metadata.producedAt` are present

Fail the gate if the specialist returns only freeform text or tool logs.

### Gate 3: RelayFile evidence shape

This gate applies only when durable evidence is written.

It passes only if all of the following are true:

- durable refs point under `/evidence/{assistantId}/{requestId}/`
- artifact extensions match content type
- `manifest.json` exists beside the artifacts
- manifest entries match findings evidence IDs
- each manifest entry includes `path`, `kind`, `contentType`, `sizeBytes`, `confidence`, and `title`
- findings `durableEvidenceCount` equals the number of durable refs emitted

Fail the gate if Sage writes arbitrary product paths, omits the manifest, or stores evidence that cannot be correlated back to findings.

### Gate 4: Answer grounding quality

The final Sage answer passes only if all of the following are true:

- claims about the PR can be traced to evidence items or clearly labeled gaps
- the answer cites the key changed files, risks, or review state from structured evidence rather than from ungrounded synthesis
- uncertainty is preserved from `gaps` and `confidence`, not hidden
- if the answer recommends a next step, that step is supported by the findings

Fail the gate if the answer sounds plausible but cannot be traced back to findings.

### Gate 5: Plan grounding quality

When Sage produces a follow-up plan, it passes only if all of the following are true:

- each proposed follow-up action is tied to a specific finding, gap, or recommended action
- no plan step assumes parallel delegation or extra specialists unless those are explicitly outside v1 and marked future work
- user-facing next steps do not overstate certainty beyond the findings confidence

Fail the gate if the plan leaps from evidence to unproven architecture or product commitments.

---

## Concrete Proof Tasks

### Task A: Contract fixtures

Create fixed fixtures for:

- a valid `DelegationRequest` for `pr_investigation`
- a complete `SpecialistFindings`
- a partial `SpecialistFindings` with gaps
- a failed `SpecialistFindings`
- a valid evidence manifest with one durable artifact

### Task B: Coordinator-side proving

Implement:

- request construction
- Relay send/receive correlation by `requestId`
- findings validation before synthesis
- fallback when findings are invalid, timed out, or failed

### Task C: Specialist-side proving

Implement:

- VFS-first PR read
- API fallback when enabled
- evidence assembly with provenance and confidence
- durable diff/report write when size exceeds inline guidance
- status handling as ephemeral only

### Task D: Answer and plan evaluation

Run proving scenarios where Sage must answer:

- what changed
- what the main risks are
- what is still unclear
- what should happen next

Compare against the current inline path and require an observable improvement in at least one of:

- provenance visibility
- explicit uncertainty handling
- preservation of structured risk details

---

## Exit Criteria

The proof plan is complete only when:

- the bounded Sage proving slice works end to end
- all five validation gates pass
- the implementation reveals a small, concrete set of abstractions worth extracting
- Sage can then re-adopt the extracted substrate without evidence or grounding regression

If the proof cannot meet those criteria, the correct action is to narrow the slice further or fix the Sage proving path, not to add more generic architecture.

---

V1_SPECIALIST_DELEGATION_PROOF_PLAN_READY
