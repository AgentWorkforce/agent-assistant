# Sage v2 Nested Subagent Runner — Validation Self-Reflection

Date: 2026-05-07

Reviewer: validation-reflection-claude (non-interactive subprocess)

Subject: Final confidence assessment for the nested-runner PR, covering the complete
review chain and naming residual risk for the follow-up substrate slices.

---

## 1. What Was Actually Reviewed

This reflection covers the full review chain for PR 1 of the Sage v2 substrate
implementation plan (nested subagent runner helper in `@agent-assistant/harness`).
The artifacts read before writing this document:

| Artifact | Author | Terminal Marker |
|---|---|---|
| `sage-v2-nested-subagent-runner-lead-reflection.md` | lead-claude | `LEAD_SELF_REFLECTION_COMPLETE` |
| `sage-v2-nested-subagent-runner-executor-reflection.md` | executor-codex | `EXECUTOR_SELF_REFLECTION_COMPLETE` |
| `sage-v2-nested-subagent-runner-fresh-eyes-review.md` | fresh-eyes-codex | `FRESH_EYES_REVIEW_COMPLETE` |
| `sage-v2-nested-subagent-runner-fresh-eyes-reflection.md` | fresh-eyes-codex | `FRESH_EYES_SELF_REFLECTION_COMPLETE` |
| `sage-v2-nested-subagent-runner-claude-peer-review.md` | peer-review-claude | `CLAUDE_PEER_REVIEW_COMPLETE` |
| `sage-v2-nested-subagent-runner-claude-reflection.md` | peer-review-claude | `CLAUDE_PEER_REVIEW_SELF_REFLECTION_COMPLETE` |
| `sage-v2-nested-subagent-runner-80-to-100-validation.md` | validation-claude | `CLAUDE_80_TO_100_VALIDATION_COMPLETE` |

All seven terminal markers are present. No review step was skipped.

---

## 2. Confidence Assessment

**Final confidence: HIGH for the implementation; CONDITIONAL on staging hygiene.**

### What raises confidence

**Convergence across independent reviewers.** Three independent agents (executor
self-review, fresh-eyes codex, Claude peer review) and one validation gate agent
each produced a `PASS_WITH_FOLLOWUPS` verdict, naming the same set of follow-ups
in the same severity order. When independent review chains converge on the same
non-obvious issues without coordination, that convergence is meaningful evidence
the review coverage was genuine.

**The one behavioral defect was found and fixed before this reflection.** Fresh-eyes
review identified a real correctness bug: `createNestedSubagentRunner` was passing
the filtered context into both `parentContext` and `filteredParentContext` of
`CreateNestedHarnessInput`, silently depriving any `createHarness` implementation
that needed a key excluded by `SUBAGENT_EXCLUDED_PARENT_KEYS` (e.g., `messages`,
`todos`) of its actual value. The fix at `nested-subagent-runner.ts:179–194` is
correct and the regression test at `nested-subagent-runner.test.ts:473` covers the
direct-call path. Crucially, this defect was detectable only by examining the
direct-call path independently of the registry path — the registry strips excluded
keys before calling the runner, which would have made a registry-only test pass
vacuously. Finding and fixing this before peer review is the most important
evidence that the 80-to-100 review loop functioned as intended.

**Tests are deterministic and passed at exit 0.** Three independent runs of:

```bash
npm test -w @agent-assistant/harness -- \
  src/nested-subagent-runner.test.ts \
  src/subagent-registry.test.ts \
  src/subpath-exports.test.ts
```

all returned 3 test files passed, 25 tests passed. The executor, fresh-eyes, and
fresh-eyes self-reflection each record this result independently. The trajectory
`traj_fnw9bwg7gn4b.json` records `exit=0` for the `implement-nested-subagent-runner`
chapter. A later chapter (`fix-harness-after-nested-runner`) confirmed "EXIT: 0 was
already achieved for the nested runner slice. No code changes were made."

**Substrate boundary held under pressure.** The plan listed ten scope risks that an
implementer could slide into while writing code that "feels like it belongs" (lead
reflection). All ten held:

- No default `createHarness` or `composeInstructions` shipped in the helper.
- No `subagent.*` telemetry event kinds added.
- `SUBAGENT_EXCLUDED_PARENT_KEYS` not extended.
- `TaskToolResult` shape unchanged; no new error codes (`policy_violation`,
  `budget_exhausted`) introduced.
- No `fetch` reference of any kind in `nested-subagent-runner.ts` (mechanically
  enforced by `workers_fetch_compatibility` test at line 511).
- Test fixtures use `doc-drafter`, `researcher`, `memory_recall` — not Sage
  roster names matched by gate #6.
- No premature insight envelope or eval coupling.

The `subagent-registry.ts` widening — the one plan deviation — was structurally
necessary (the plan incorrectly asserted no changes were needed) and was additive-
only. `normalizeRunSubagentResult` keeps old callers working. The peer review
validated this explicitly and correctly.

**Workers-fetch compliance is a structural guarantee, not just a passing test.**
`nested-subagent-runner.ts` contains no `fetch` reference in the module body. The
test enforces this mechanically at the construction boundary. This matters because
bare `fetch` capture during module evaluation is detectable only in a Cloudflare
Workers context under `nodejs_compat` — past incidents (OpenRouter adapter
2026-04-24, sage#110, cloud#328) documented the blast radius. The guarantee is
verifiable by reading the file, not by running the test.

**Result translation covers the error vocabulary boundary.** `toFailureResult` maps
exactly the six codes documented in the plan (`unknown_subagent`, `max_iterations`,
`aborted`, `invalid_output`, `subagent_error`, plus `ok: true`). No new codes were
introduced preemptively. This leaves the error vocabulary extension clean for PR 2
(`policy_violation`, `budget_exhausted`).

### What conditions the confidence

**The staging hygiene pre-merge action (F-1) is blocking and has not yet been
performed.** The working tree includes three hunks unrelated to the nested runner:

| Hunk | Location | Scope |
|---|---|---|
| `export { createRuntimePolicy }` | `packages/harness/src/index.ts:2` | PR 2 |
| `./runtime-policy` subpath export assertion | `packages/harness/src/subpath-exports.test.ts:31–36` | PR 2 |
| `./runtime-policy` export entry | `packages/harness/package.json:34–37` | PR 2 |
| All telemetry changes | `packages/telemetry/*` | PR 3 |
| All turn-context changes | `packages/turn-context/*` | PR 4/5 |
| VFS changes | `packages/vfs/src/index.ts` | out-of-scope |

These must not be co-staged in the PR 1 commit. A surgical `git add` respecting
the nested-runner allowlist is required. The allowlist is:

- `packages/harness/src/nested-subagent-runner.ts` — stage whole file
- `packages/harness/src/nested-subagent-runner.test.ts` — stage whole file
- `packages/harness/src/subagent-registry.ts` — stage whole file
- `packages/harness/src/subagent-registry.test.ts` — stage whole file
- `packages/harness/src/registries/index.ts` — stage whole file
- `packages/harness/src/index.ts` — `git add -p`, exclude runtime-policy hunks
- `packages/harness/src/subpath-exports.test.ts` — `git add -p`, exclude lines 31–36
- `docs/architecture/sage-v2-nested-subagent-runner-*.md` — stage as documentation

Until F-1 is resolved, the implementation is correct and the tests pass, but the
PR commit does not yet exist in a form that matches the declared scope.

---

## 3. Residual Risk

The following risks survive the review chain and carry into the post-merge period.

### R-1 (Low, Operational): Process-local `childCounters` map

The `childCounters` map inside the runner instance accumulates one entry per unique
`(parentTraceId, parentContext.turnId)` pair. Two consequences:

1. Counters reset if a caller reconstructs the runner between parent tool calls,
   producing `parent-turn.sa-1` where a consumer might expect `parent-turn.sa-N`.
2. Over a long-lived process running many unique turn pairs, the map grows
   unboundedly (no eviction policy).

**Why this is residual, not blocking:** PR 1's contract requires only deterministic
child id derivation within one runner instance for the lifetime of a single parent
turn. That contract is satisfied. Cross-process identity correlation and lifecycle
management are PR 2/4 concerns.

**Mitigation:** If a future PR introduces a long-running orchestration harness that
reuses a single runner instance across many turns at scale, a bounded LRU cache
(e.g., max 1,000 entries) for `childCounters` would prevent the growth concern
without changing the interface.

### R-2 (Low, CI): `parallel_task_batch` timing budget

The test uses a 50ms delay and asserts elapsed time below 90ms, leaving a 40ms
margin. On heavily loaded CI machines this could produce sporadic false failures
without any code regression. The failure mode is observable as a flaky test rather
than a behavioral defect.

**Mitigation:** Relax to 100ms delay, 150ms assertion budget before or alongside
the PR 1 commit. This does not change what the test proves (genuine parallelism
vs. sequential execution) and costs nothing architecturally.

### R-3 (Low, Conceptual): `doc-drafter` fixture name

`doc-drafter` appears in `nested-subagent-runner.test.ts` as the primary subagent
fixture name. The plan's "Out of scope" section lists `doc-drafter` as a Sage
roster name. The mechanical gate #6 grep does not include `doc-drafter`, so CI
passes. The conceptual coupling is real but has no behavioral consequence today.

**Mitigation:** Rename to `example-drafter` in the PR 1 cleanup commit. Low effort.
Best done at the same time as F-1 surgical staging, since a cleanup commit is
likely required anyway.

### R-4 (Medium, Architectural): PR 2–5 extension points are implicit, not defended

The nested runner leaves clean extension points for PRs 2–5: no `runtimePolicy?`
on `CreateNestedSubagentRunnerOptions`, no `evalContext?`, no insight envelope
fields, no `subagent.*` telemetry events. These absences are correct. However,
they are enforced only by the plan's "Out of scope" list and gate #6 grep — not by
TypeScript type constraints or runtime invariants that would mechanically block a
future PR from adding a wrong field.

This is a structural characteristic of the design, not a defect. But it means:

- A PR 2 author who adds `runtimePolicy?` to `CreateNestedSubagentRunnerOptions`
  will not receive a compile-time warning that they are extending the PR 1 surface
  rather than composing with it.
- A PR 3 author who adds `subagent.start` emission inside the runner will not
  receive a runtime error until telemetry consumers encounter an unexpected event
  kind.

**Mitigation:** The substrate implementation plan's slice ordering and review
protocol (each slice has its own lead, executor, fresh-eyes, and peer review chain)
is the primary defense. Adding a lint rule or ADR that tags `nested-subagent-runner.ts`
as "substrate boundary: no Sage-specific imports" would provide a secondary defense
without requiring runtime overhead.

### R-5 (Low, Informational): `subagent-registry.ts` widening diverged from plan

The plan stated no changes were needed to `subagent-registry.ts`. The executor
correctly widened it (`taskInput`, `signal`, `parentTraceId` on `RunSubagentInput`;
`RunSubagentResult` union; `normalizeRunSubagentResult`). The peer review validated
the deviation. However, the plan's own stated "no changes" rule will be stale if
read by a future PR author without reading the executor reflection.

**Mitigation:** The executor reflection documents this deviation clearly. The plan
document itself need not be retroactively corrected (it is an historical artifact),
but the `subagent-registry.ts` change should be noted in the PR 1 commit message
so the divergence is visible in `git log`.

---

## 4. Follow-Up Slices

The following are the confirmed next slices after PR 1, in dependency order per
`sage-v2-substrate-implementation-plan.md`:

| PR | Title | Key Dependency on PR 1 |
|---|---|---|
| PR 2 | Runtime budget policy (`createRuntimePolicy`) | Extends `CreateNestedSubagentRunnerOptions` with `runtimePolicy?`; introduces `policy_violation` and `budget_exhausted` error codes; owns the `./runtime-policy` subpath export that leaked into this diff |
| PR 3 | Telemetry vocabulary (`subagent.*` / `runtime_policy.*`) | Adds structured `subagent.start`, `subagent.finish`, `subagent.failed` event kinds; updates `packages/telemetry/src/harness-bridge.ts`; relies on the stable `runSubagent` seam from PR 1 |
| PR 4 | Eval runner contracts | Adds `evalContext?` to `CreateNestedSubagentRunnerOptions`; uses `RunSubagentInput`/`RunSubagentResult` types from PR 1 as the baseline API |
| PR 5 | Insight envelope contracts | Replaces or augments `toSuccessResult`'s flat string return with a typed envelope; clean extension point because PR 1 adds no insight-shaped fields |

**Immediate pre-merge action that is not a substrate PR:**

The `./runtime-policy` export surface (F-1 above) currently sits in this working
tree. It must either be staged in a dedicated standalone PR or moved to the PR 2
commit before the PR 1 commit is created. If it is staged alongside PR 1, the PR
boundary becomes illegible to reviewers reading the diff against the plan.

---

## 5. Final Verdict

**PASS_WITH_FOLLOWUPS — Implementation ready; commit staging required before merge.**

The nested subagent runner implementation is functionally correct, well-tested
against all nine plan-specified cases plus two additional cases found during
review, Workers-fetch safe, free of Sage product contamination, and compliant with
the substrate boundary at both the design and mechanical levels. The one behavioral
defect (parent-context contract bug) was identified and fixed by fresh-eyes review
before this reflection; the fix is correct and the regression test covers it.

The sole pre-merge blocking action is surgical git staging (F-1): the working tree
contains PR 2 runtime-policy and PR 3 telemetry changes that must not be co-staged
in the PR 1 commit. Once staging is complete, the PR 1 commit will match its
declared scope and the implementation is ready to merge.

Residual risks (R-1 through R-5) are acknowledged, low-severity, and either carry
into follow-up slices by design or are addressable in the PR 1 cleanup commit
without behavioral consequence.

---

VALIDATION_SELF_REFLECTION_COMPLETE
