# improve-harness-primitives

Five primitives lifted upstream from sage's Slack-bot failure-mode fixes
(sage PR #155). Each was a sage-side workaround for something general
enough that any `@agent-assistant/harness` consumer would re-invent.
Pulling them upstream lets sage drop its local copies in a follow-up
adoption PR — and gives future consumers a head start.

## Primitives

| # | Sub | Primitive | Why |
|---|---|---|---|
| 1 | `01-clarification-exclude-tools.ts` | `excludeToolNames` option on `createToolEvidenceClarificationHook` | Read-only tools (memory_recall) shouldn't trigger empty-result clarifications. Today sage wraps locally; this lifts the join point upstream. |
| 2 | `02-idempotency-guard.ts` | `createIdempotencyGuard(inner, options?)` | Block 2nd identical (name + input) tool call within a turn. Catches the "interleave to dodge the consecutive-loop detector" pattern. |
| 3 | `03-github-public-review.ts` | `GitHubPublicFetcher` + `createGitHubPublicReviewToolRegistry` | Closes the cross-org external public-repo review use case. Unauthenticated `api.github.com`, Workers-safe. |
| 4 | `04-prompt-fragments.ts` | `DRILL_IN_DISCIPLINE_CLAUSE`, `TOOL_INPUT_SHAPE_REMINDER_CLAUSE`, `EXTERNAL_REPO_STEER_CLAUSE` (+ `TOOL_DISCIPLINE_CLAUSES` bundle) | Three near-identical nudges every harness consumer authors locally — co-locate with `HALLUCINATION_PREVENTION_CLAUSES`. |
| 5 | `05-openrouter-error-codes.ts` | `HarnessInvalidOutputCode` + OpenRouter adapter wiring | Stable machine-readable subcode (credits_exhausted / rate_limited / timeout / …) so consumers stop substring-matching `reason`. |

## Layout

| File | Purpose |
|---|---|
| `00-execute.ts` | Master — applies `applyAgentAssistantRepoSetup` once, then runs subs sequentially as deterministic shell steps |
| `01-clarification-exclude-tools.ts` | Sub 1 — additive option on existing clarification factory |
| `02-idempotency-guard.ts` | Sub 2 — new registry wrapper module |
| `03-github-public-review.ts` | Sub 3 — new fetcher + tool registry |
| `04-prompt-fragments.ts` | Sub 4 — three new exports + bundle |
| `05-openrouter-error-codes.ts` | Sub 5 — type extension + adapter wiring |
| `06-publish-pr.ts` | Holistic lead review + commit + push + PR |

## Run

```bash
agent-relay run workflows/improve-harness-primitives/00-execute.ts
```

Each sub fails fast with `process.exit(1)` if its tests / tsc don't
pass. Master also greps stdout for `Workflow status: failed` as a second
guard (per memory: agent-relay run can exit 0 even when the inner
workflow fails). Branch left at `feat/improve-harness-primitives` on
failure for inspection.

## Backwards compatibility

All changes are additive:

- New optional `excludeToolNames` field on existing options interface.
- New `createIdempotencyGuard` factory — opt-in via wrapping.
- New `GitHubPublicFetcher` + tool registry — separate module.
- New prompt fragment exports next to existing ones.
- New optional `code` field on `HarnessInvalidOutput`. `kind` and `reason` unchanged.

Single minor bump on `@agent-assistant/harness`.

## Followup (not in this workflow)

Sage adoption PR drops sage's local `withRedundantCallGuard`, the local
clarification wrapper filtering `memory_recall`, sage's
`GitHubPublicFetcher`, the inlined prompt-extension strings, and the
substring-matching `getUserFacingErrorMessage` in favor of these
upstream exports.
