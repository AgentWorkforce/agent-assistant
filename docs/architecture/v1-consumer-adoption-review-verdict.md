# v1 Consumer Adoption Review Verdict

**Date:** 2026-04-12
**Review target:**
- `docs/architecture/v1-consumer-adoption-contract.md`
- `docs/consumer/nightcto-adoption-path.md`
- `docs/consumer/sage-adoption-path.md`
- `docs/consumer/msd-adoption-path.md`
- `docs/consumer/consumer-adoption-matrix.md`
- `docs/architecture/v1-consumer-adoption-rollout-plan.md`

## Verdict

**PASS_WITH_FOLLOWUPS**

The planning outputs are materially useful and much more actionable than a generic adoption memo, but they are not fully "pick up and execute immediately" for all three consumers. The main issue is not structure. The main issue is confidence: the docs are internally coherent, but they overstate package readiness relative to the repo's own status record and they still leave several product-critical wiring details as named placeholders rather than resolved implementation targets.

## Findings

### 1. The adoption paths are only partially concrete enough to act on immediately

The deliverables satisfy the contract shape well. Each consumer doc includes the required sections, names example assembly files, identifies product-local ownership, and calls out deferred packages. That is strong.

They are not equally execution-ready, though:

- **NightCTO:** close to actionable, but still blocked on unidentified concrete Relay inbound/outbound adapters, unresolved scheduler binding compatibility, and a known gap in `05-full-assembly.ts` for watch-trigger-to-policy coverage. The rollout plan says "there is no design work required," but the same document still lists several unresolved technical confirmations. Those are real design/integration tasks, not clerical follow-through.
- **Sage:** directionally actionable, but the core product behavior is still described as examples of heuristics rather than a defined first rule set. "Workspace-activity condition" and "knowledge-staleness watch condition" are still placeholders for the actual adoption logic.
- **MSD:** the shape is clear, but the path still depends on authoring a real risk classifier and product tests that exercise non-allow branches. That means the policy-heavy proof MSD cares about is not yet demonstrated by the upstream example it is told to start from.

Bottom line: these are concrete enough to plan execution and start implementation discovery, but not concrete enough to treat as zero-ambiguity runbooks.

### 2. The package readiness judgment is not fully realistic

This is the weakest part of the set.

The adoption docs classify `@relay-assistant/policy` and `@relay-assistant/proactive` as ready-now packages for consumer adoption, but `docs/current-state.md` still lists both as **placeholder** packages and defines the v1 safe product baseline as only:

- `@relay-assistant/core`
- `@relay-assistant/sessions`
- `@relay-assistant/surfaces`
- `@relay-assistant/traits`

That contradiction matters because the rollout recommendation depends heavily on NightCTO adopting all four "ready-now" packages. If the repo's authoritative status snapshot is still the source of truth, then the readiness call in the consumer adoption docs is overstated.

There is supporting evidence that some of the newer readiness claims are grounded:

- the consumer docs cite concrete passing test counts for `core`, `traits`, `policy`, and `proactive`
- `packages/examples/src/03-policy-gated-assistant.ts`, `04-proactive-assistant.ts`, and `05-full-assembly.ts` do show real composition patterns
- the earlier assembly review already concluded the examples are useful but incomplete, especially for full proactive-policy coverage and non-allow policy outcomes

So the realistic judgment is:

- `core` and `traits`: clearly ready
- `policy` and `proactive`: promising and probably near-ready for controlled early adoption, but not convincingly established as unconditional "ready-now" until `docs/current-state.md` is reconciled and the example/proof gaps are closed
- blocked packages (`memory`, `routing`, `coordination`, `connectivity`): the defer judgment is reasonable in direction, but at least one cited blocker is stale because `packages/connectivity/package.json` already includes `nanoid`

### 3. The recommended first adopter is justified, but not as strongly as claimed

**NightCTO** is a defensible first adopter if the goal is maximum SDK validation per adoption. The docs are correct that it:

- exercises the broadest package set
- hits the hardest composition pattern
- gives downstream products a reusable proactive-to-policy integration reference

That said, the justification is overstated in two ways:

1. The docs present NightCTO as near-definitive because it covers four packages, but that argument assumes `policy` and `proactive` are already settled as ready-now for product use. The repo's current-state doc does not yet support that assumption.
2. The rollout plan underweights execution friction. NightCTO is also the consumer with the most missing concrete wiring details and the one most exposed to the known `05-full-assembly.ts` gap.

So the recommendation is good, but conditional:

- If the objective is **maximum validation value**, NightCTO first is well justified.
- If the objective is **fastest low-risk first proof this weekend**, Sage could be argued as the easier first integration because it avoids policy and uses a simpler composition path.

The docs should acknowledge that tradeoff explicitly instead of presenting NightCTO as effectively uncontested.

## Assessment

### 1. Are these adoption paths concrete enough to act on immediately?

**Partially.**

They are concrete enough to begin implementation planning and wiring work, especially for NightCTO. They are not concrete enough to execute without additional local discovery because key adapters, scheduler compatibility, audit sink interfaces, and some first-pass product rules remain unresolved.

### 2. Is the package readiness judgment realistic?

**Not yet.**

The defer-later calls are mostly sensible, but the ready-now judgment for `policy` and `proactive` is not fully credible while `docs/current-state.md` still contradicts it and while known example-proof gaps remain open.

### 3. Is the recommended first adopter well justified?

**Yes, with caveats.**

NightCTO is the best first adopter for proving the richest composition pattern, but the case is weaker than the rollout plan claims because NightCTO also carries the most unresolved wiring risk and depends on readiness assumptions that have not been reconciled across the repo.

## Required Follow-Ups

1. Reconcile `docs/current-state.md` with the adoption docs. The repo needs one authoritative readiness judgment for `policy` and `proactive`.
2. Remove stale blocker claims around `connectivity` if `nanoid` is now present, or explain why the package is still effectively blocked despite the dependency being declared.
3. Downgrade "immediate adoption" language for NightCTO until the concrete Relay adapter classes, scheduler binding contract, and audit sink shape are identified.
4. Tighten the first implementation slice for Sage and MSD by replacing heuristic placeholders with one explicit starter rule set per product.
5. Keep the recommendation of NightCTO first, but state the tradeoff against a simpler Sage-first rollout if the goal shifts from maximum validation to fastest first success.

## Summary

The consumer adoption planning set is useful and worth keeping. It has good structure, a coherent contract, and a sensible adoption ordering model. The problem is that it currently reads one maturity level higher than the repo evidence supports. That makes this a **PASS_WITH_FOLLOWUPS**, not a clean pass and not a fail.

Artifact produced:
- `docs/architecture/v1-consumer-adoption-review-verdict.md`

V1_CONSUMER_ADOPTION_REVIEW_COMPLETE
