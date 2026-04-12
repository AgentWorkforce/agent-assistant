# Review Verdict: Relay Agent Assistant Docs Scaffold

> **Note:** This document was written when the project was named "RelayAssistant" with package scope `@relay-assistant/*`. The project has since been renamed to **Agent Assistant SDK** with scope `@agent-assistant/*`. References to the old name in this document are historical.

Date: 2026-04-11
Verdict: **PASS_WITH_FOLLOWUPS**

---

## Overall Assessment

The scaffold is coherent, principled, and ready to anchor team alignment. The three-layer model (Relay foundation → Assistant SDK → product repos) is consistently expressed across every document. The OSS/cloud split is explicit and well-reasoned. Consumer adoption guidance is product-specific enough to be actionable for Sage, MSD, and NightCTO. Package boundaries are clean.

The gaps are real but not blocking. They are documentation completeness issues, not architectural confusion. This repo can become the canonical research repo once the followups below are resolved.

---

## Assessment by Criterion

### 1. Repo organization and coherence

**Finding: Strong.**

The root README acts as a solid entry point. It defines the layer model, lists all packages, links every doc, and states current status clearly. The `DOCS_FIRST_SCAFFOLD_READY` marker at the end of the README is a useful signal.

Every doc is dated 2026-04-11 and internally consistent. Cross-references between docs are accurate. The package map in the README matches the boundary map matches the extraction roadmap matches the per-package READMEs. No contradictions found.

Minor issue: there is no `docs/` index or sidebar document. Readers entering the repo from a non-root path (e.g., landing on `docs/research/internal-system-comparison.md` directly) have no nav context. A lightweight `docs/index.md` or a link block in each doc's header would help.

### 2. Consumer adoption guidance for Sage/MSD/NightCTO

**Finding: Good. Specific enough to be actionable.**

`how-to-build-an-assistant.md` gives a concrete 7-step build order, product-specific package selection per assistant type, and explicit "what to avoid" guidance. This is the right shape for a developer onboarding doc.

`how-products-should-adopt-agent-assistant-sdk.md` gives a 4-step adoption sequence and per-product adoption priority with rationale. The decision test ("would Sage, MSD, and NightCTO all plausibly use this with different configuration or adapters") is a clean heuristic that teams can apply independently.

Gaps:
- There is no end-to-end pseudo-code assembly example. The illustrative imports in `how-to-build-an-assistant.md` are useful but stop short of showing how the pieces wire together even at a conceptual level. A single 20–30 line skeletal assembly example — even if entirely illustrative — would significantly reduce the activation energy for a new consumer.
- No failure or degradation guidance. What should a product do if the session store is unavailable? If coordination fails mid-request? Even a one-paragraph stub on graceful degradation expectations would set the right tone for consumers.
- The "MSD-style assistant" profile in `how-to-build-an-assistant.md` lists `core`, `sessions`, `surfaces`, `coordination`, `policy` but does not list `memory`. The `how-products-should-adopt-agent-assistant-sdk.md` MSD section also omits `memory`. If MSD genuinely has no memory requirements, that should be stated explicitly rather than left as an implied omission.

### 3. OSS vs cloud split

**Finding: Excellent. This is the strongest section of the scaffold.**

`oss-vs-cloud-split.md` is precise. The dependency direction rule ("cloud packages may depend on OSS packages; OSS packages must not depend on cloud packages") is unambiguous. The design constraint ("can a self-hosted or local consumer implement this without any private service") gives every future contributor a self-service boundary test.

The naming proposal (`@relay-assistant/*` for OSS, `@relay-assistant-cloud/*` or a separate repo for cloud) is appropriately deferred without leaving the boundary undefined.

The root README reinforces this: "That later cloud layer should depend on this SDK, not replace it." This single sentence prevents the most common failure mode of cloud-specific assumptions creeping into OSS contracts.

No issues with this section.

### 4. Package boundaries

**Finding: Generally clean. Two edges need sharpening.**

The "owns / must not own" pattern used in `package-boundary-map.md` and echoed in each package README is the right approach. The boundaries are principled, not arbitrary. The extraction table in `package-boundary-map.md` (mapping source signals to destination packages) is particularly useful.

Issues found:

**Issue A — surfaces/delivery fanout edge is fuzzy.**
`@relay-assistant/surfaces` owns "delivery fanout rules at the assistant layer." But `package-boundary-map.md` says Relay foundation owns "outbound delivery." The line between assistant-layer fanout and transport-layer delivery is not drawn. A reader implementing a multi-surface delivery feature would not know which layer handles fan-out when one assistant message must go to multiple channels simultaneously. This needs a clarifying sentence or example.

**Issue B — examples package publish signal is wrong.**
Every package README uses the same illustrative import pattern, including `examples`:
```ts
import { exampleAssistant } from "@relay-assistant/examples";
```
This implies `examples` is a production npm dependency. Examples packages should not be imported by product code in production. The README says "consumers should use this package for guidance, not as a production dependency" but the illustrative import undercuts that message. Remove the illustrative import from the examples README or replace it with a clear dev-only / reference-only framing. Consider renaming the directory to `examples/` (no package scope) to make the non-production nature explicit.

**Issue C — core as composition hub needs a note.**
`@relay-assistant/core` owns "composition of memory, sessions, surfaces, proactive, coordination, and policy packages." At docs-first stage this is fine, but it raises a question for Phase 1 implementers: does `core` import all other packages (creating a fan-in dependency), or does it define interfaces that other packages implement against? If `core` imports all others, it becomes the heaviest dependency in the graph and defeats modular adoption. If it only defines shared types, its role is different from what the docs suggest. This should be clarified before Phase 1 begins.

### 5. What should be fixed before this becomes the canonical research repo

**Blocking for canonical status:**

1. **Add a glossary.** Terms used across all docs — "assistant session," "surface," "specialist," "coordinator," "watcher," "evidence," "affinity," "compaction," "promotion" — are undefined. Readers unfamiliar with the AgentWorkforce vocabulary have no reference. A `docs/reference/glossary.md` with one-paragraph definitions per term is required for this to be legible to anyone beyond the immediate team.

2. **Clarify the surfaces/delivery fanout boundary** (see Issue A above). One added paragraph or example in `package-boundary-map.md` resolves this.

3. **Fix the examples package import signal** (see Issue B above). Low effort, high clarity gain.

**Strongly recommended before canonical status:**

4. **Add a skeletal assembly example.** Even 25 illustrative lines in `how-to-build-an-assistant.md` showing how `createAssistant`, `createSessionStore`, `createSurfaceConnection`, and optionally `createMemoryStore` compose would dramatically reduce consumer onboarding friction.

5. **Add versioning and stability signals.** None of the docs mention how packages will be versioned, what the stability guarantee is for Phase 1 contracts, or how breaking changes will be communicated. This is essential before any product team invests in adopting the interfaces.

6. **Strengthen `internal-system-comparison.md`.** As the sole research document, it is thin. It correctly identifies signals per system but does not analyze overlap or divergence between systems in any depth. For example: how similar is Sage's memory model to NightCTO's per-client continuity? What would a shared `MemoryStore` interface need to satisfy both? Where do their requirements conflict? The research doc should answer these questions rather than leaving them to Phase 2 discovery.

7. **Clarify `core`'s composition role** (see Issue C above). One paragraph in `package-boundary-map.md` or `core/README.md` resolves this before Phase 1.

8. **Clarify MSD's memory posture.** If MSD has no memory requirements, say so explicitly and explain why. If it does, add `@relay-assistant/memory` to the MSD adoption profiles in both consumer docs.

**Optional but useful:**

9. Add a `docs/index.md` or navigation block at the top of each doc so readers can orient regardless of entry point.

10. Add a brief "not yet in scope" section to `extraction-roadmap.md` listing capabilities explicitly deferred beyond Phase 5 (e.g., observability, testing utilities, CLI tooling). This prevents scope creep debates during implementation.

---

## Summary Table

| Criterion | Rating | Key Issue |
| --- | --- | --- |
| Repo organization and coherence | Strong | No docs navigation index |
| Consumer adoption guidance (Sage/MSD/NightCTO) | Good | No skeletal assembly example; MSD memory posture ambiguous |
| OSS vs cloud split | Excellent | None |
| Package boundaries | Good | surfaces/fanout edge fuzzy; examples import anti-pattern; core composition role unclear |
| Readiness for canonical research repo | Conditional | Needs glossary, stability signals, stronger research doc |

---

## Verdict

**PASS_WITH_FOLLOWUPS**

The scaffold earns a pass. The layer model is sound, the OSS/cloud split is correctly enforced in every document, and the per-product adoption guidance is specific enough to be useful. The gaps are documentation completeness issues — missing glossary, thin research doc, two fuzzy package edges, no versioning signals — not architectural errors. Resolve the blocking items above and this becomes the canonical research repo without further structural work.

REVIEW_COMPLETE
