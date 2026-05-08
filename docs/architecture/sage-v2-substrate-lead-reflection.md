# Sage v2 Substrate — Lead Self-Reflection

Date: 2026-05-07

Audience: Codex (executor) and the workflow owner. This is a candid review of
the architecture contract in
`docs/architecture/sage-v2-substrate-implementation-plan.md` against the source
extraction map (`sage-v2-substrate-extraction-map.md`), the ownership rule in
`runtime-primitives-vs-product-intelligence.md`, and the 80-to-100 skill.

The plan is implementation-ready, but several risks deserve to be called out
before code is written.

## 1. Risks That Sage Product Intelligence Leaks Into Agent Assistant

The plan names the boundary loudly ("Out of scope (stays in Sage)") and adds a
grep gate against `slack-researcher|competitor-researcher|...|SAGE_`. Even so,
there are residual ways Sage intelligence could ride into the substrate:

- **Drill-or-stop tags become a product taxonomy.** Slice 2 introduces tool
  tags `category: "planning" | "broad"` and `produces: "candidates"`. If
  substrate ships an enum or a "blessed" set of categories, the substrate
  starts encoding what counts as broad — that is product judgment. Mitigation:
  keep the tag values as opaque strings supplied per consumer, validate only
  shape, and add a test that asserts no enum is exported. Reject any PR that
  adds a default category list.
- **Default normalizers and tool name lists.** `todoRewriteCap.toolNames` and
  `toolResultCache.normalize` are configurable, but if the implementer adds a
  "sensible default" (e.g. `["write_todos"]`) for ergonomics, the harness now
  knows a Claude Code-shaped tool name. Mitigation: defaults must remain
  empty/disabled. Add a unit test that an unconfigured policy is a no-op for
  every primitive.
- **Eval fixtures shaped like Sage turns.** Slice 4 says "synthetic echo
  assistant," but it is easy to slip toward fixtures that mirror Sage's real
  flow (Slack research → Notion write). Mitigation: fixtures must reference
  fictional providers/tools (`provider-a`, `tool-x`) and the test file must
  not contain Slack/Notion/GitHub strings — add a grep gate to the eval
  package the same way Slice 1/2 have one.
- **Insight envelope `sourceProvider` becoming an enum.** Slice 5 keeps it as
  an opaque string, but TypeScript ergonomics may tempt a literal union.
  Mitigation: keep `sourceProvider: string` and add a type-level test that the
  field accepts any string.
- **Telemetry payload shapes that smuggle product semantics.** If
  `subagent.started` accumulates fields like `roster`, `specialty`, or
  `domain`, those fields become a soft schema for product behavior even if
  named generically. Mitigation: keep payloads to bounded scalars and opaque
  ids, and assert in tests that no telemetry event has a field named after a
  Sage role.
- **Sanitizer regex tuned to Sage's specific leak patterns.** The sanitizer
  must be motivated by general pseudo-tool syntax, not a particular Sage
  prompt artifact. Mitigation: fuzz table must include non-Sage shapes
  (XML-ish, markdown-fenced, JSON-embedded) and reject any test name that
  references a Sage incident.

## 2. Risks The Workflow Misses An 80-To-100 Gate

The plan's 80-to-100 validation contract is strong on the deterministic gates
(typecheck, test, lint, build, two grep gates, regression run) and on the
review chain. The places it can still fall short of the 80-to-100 standard
("feature works, tested E2E locally," not just "code compiles"):

- **No cross-package integration evidence.** Each slice gates on its own
  package. The point of substrate is consumption — there is no gate that
  imports the new symbol from a sibling package and exercises it end to end.
  Mitigation: add an integration smoke test (per slice) that imports the new
  symbol from `@agent-assistant/harness` (or wherever) into a tiny consumer
  fixture and runs a synthetic turn. Make it part of the per-slice "Tests
  required" list.
- **Workers-fetch enforcement is grep-only at the substrate boundary.** The
  grep `! grep -rE "^(import|const).*\bfetch\b.*=.*$"` catches the obvious
  shape but not, e.g., destructured `const { fetch } = globalThis` or a class
  field initializer. Mitigation: add the runtime swap test
  (`workers-fetch.test.ts`) to every slice that touches an HTTP-capable file,
  not only Slice 1; today it is only required as a stub assertion in Slice 1
  and as a grep test in Slice 2.
- **No "publish dry-run" gate.** 80-to-100 for a published package includes
  ensuring the build artifact actually exposes the new symbols and that
  `package.json` exports map them. Mitigation: add `npm pack --dry-run` (or an
  equivalent "consume the built dist from a sibling package" smoke) as a
  hard gate before sign-off.
- **No telemetry-private-content gate at the integration layer.** Slice 3
  has `private_content_never_leaks.test.ts` at the unit level. The runtime
  policy events (Slice 2) feed telemetry but are tested in isolation.
  Mitigation: the integration smoke from the first bullet should also
  confirm policy events never carry raw tool inputs/outputs end to end.
- **Sign-off is an agent-driven step, not a deterministic gate.** "Claude
  80-to-100 sign-off" depends on Claude posting `SLICE_<n>_80_100_SIGNOFF`.
  If the agent skips a check, the gate still passes. Mitigation: the
  deterministic step in §2 of the validation contract should be the source
  of truth — sign-off is a wrapper that verifies the deterministic step's
  output exists and matches the SHA, not a freeform reading.
- **Regression suite runs at slice end, not after merge into the integration
  branch.** If two slices merge in sequence, the second slice's regression
  run does not exercise the first slice's new code paths together until both
  are landed. Mitigation: define the integration branch and require the
  regression suite to run on the integration HEAD, not on each slice branch
  in isolation, before PR publication of the second-and-later slices.

## 3. Scope-Control Adjustments Codex Should Honor Before Implementation

These are the concrete asks from this reflection. Codex should treat them as
binding for the slice PRs.

1. **No default values that name a product.** Every config field listed in
   Slice 2 (`todoRewriteCap.toolNames`, `toolResultCache.normalize`,
   `reserveFloor.blockedCategories`, `drillOrStop.candidateProducingTools`,
   `drillOrStop.broadTools`) ships with `[]` / `undefined` defaults. The
   policy is a no-op until a consumer configures it.
2. **Tag values are opaque strings.** No `type Category = "planning" | "broad"`
   union exported from substrate. Tag schemas live in product packages.
3. **Insight `sourceProvider` and `schemaVersion` stay opaque.** No literal
   union, no enum, no registry. Only shape validation.
4. **Eval fixtures use fictional names.** No `slack-*`, `notion-*`,
   `github-*`, `linear-*`, `competitor-*` strings anywhere in the eval
   package — extend the grep gate to cover the eval package once it exists.
5. **Add an integration smoke per slice.** A minimal cross-package test that
   imports the new public symbol and runs a synthetic happy path. Add it to
   the slice's "Tests required" list before opening the PR.
6. **Workers-fetch swap test is mandatory for any file with an HTTP path.**
   Not just Slice 1. Mirror
   `packages/harness/src/adapter/openrouter-model-adapter.workers-fetch.test.ts`.
7. **Treat sign-off as verification of deterministic output.** The Claude
   sign-off message must quote the deterministic gate output (commands and
   exit codes) and the SHA. No freehand "looks good" sign-offs.
8. **Run the regression suite on the integration HEAD for slices ≥ 2.** The
   first slice can run on its own branch; subsequent slices must rebase onto
   the integration branch and rerun the regression suite there before
   sign-off.

If Codex hits a case where any of the above forces an awkward shape, escalate
back to Claude rather than relaxing the rule locally — the boundary is the
whole point of the extraction.

LEAD_SELF_REFLECTION_COMPLETE
