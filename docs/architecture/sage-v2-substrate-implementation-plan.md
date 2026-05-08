# Sage v2 Substrate Implementation Plan

Date: 2026-05-07

Status: IMPLEMENTATION_READY. This is an Agent Assistant implementation contract,
not a Sage product roadmap.

Source: `tmp/sage-v2-substrate-workflow/source-context.md`, plus the published
`docs/architecture/sage-v2-substrate-extraction-map.md`.

## Scope And Ownership Boundary

This plan describes only the substrate work that lands in this repo. Anything
that encodes Sage product behavior is **out of scope** for Agent Assistant and
remains in the Sage repo.

### Out of scope (stays in Sage)

The following must not appear in any package under `packages/` in this repo, in
any prompt fragment, in any default registry, or in any test fixture that ships
as a public export:

- Sage product prompts, tone, capability matrix language, delegation
  heuristics, and `slack-runner` clauses.
- The Sage specialist roster: `slack-researcher`, `competitor-researcher`,
  `github-investigator`, `linear-investigator`, `planner`, `doc-drafter`,
  `notion-librarian`, `notion-page-writer`, `web-researcher`,
  `repo-sandbox-researcher`, `qa-verifier`.
- Slack channel semantics (`#competitors`, `#general`), Notion page/database
  semantics (`notion_create_page`, page block rendering), GitHub/Linear
  product workflows.
- `SAGE_HARNESS_SUBAGENTS_ENABLED` and any other `SAGE_*` flag.
- Sage open-issue numbers (#107, #172, #180, #189, #203, …) as identifiers in
  shared code, fixtures, or tests. They may appear only as motivation in this
  doc and PR descriptions.
- Sage workspace fixtures, scoring rubrics, or expected evidence paths.

### In scope (Agent Assistant deliverables)

Five vertical slices, each shipped as its own PR:

1. Nested subagent runner helper (`@agent-assistant/harness`).
2. Runtime budget policy primitives (`@agent-assistant/harness`).
3. Telemetry event vocabulary for subagents and runtime policy
   (`@agent-assistant/telemetry`).
4. Eval substrate for assistant turns (new `@agent-assistant/evals` or scoped
   module under telemetry — choice deferred to PR 4).
5. Insight envelope and reader helpers (`@agent-assistant/vfs` +
   `@agent-assistant/turn-context`).

A sixth follow-up (Sage re-adoption) lives in the Sage repo and is tracked here
only as a downstream consumer constraint.

## Cross-Cutting Constraints

These apply to every slice below.

### Cloudflare Workers fetch compatibility

Workers rebinds `fetch` per request. Modules that capture `fetch` at import
time crash in Workers. Therefore:

- **No bare `fetch` storage.** Do not write `const fetchImpl = fetch` or
  `import { fetch } from ...` at module top level. Do not pass `fetch` into a
  constructor and store it on `this`.
- **Call `globalThis.fetch` at invocation time.** Every HTTP boundary must
  resolve `globalThis.fetch` inside the function body of the call. The pattern
  already exists in `packages/harness/src/adapter/openrouter-model-adapter.ts`
  and the direct-provider adapters; new code must match.
- **Inject through a lambda when overrides are needed.** Tests and adapters
  pass `fetch?: typeof globalThis.fetch` as an option and call
  `(options.fetch ?? globalThis.fetch)(url, init)` at call time, never
  earlier.
- **Test coverage.** Every PR that touches an HTTP path must add or extend a
  Workers-fetch test that swaps `globalThis.fetch` after module load and
  asserts the swapped impl is used. Mirror
  `packages/harness/src/adapter/openrouter-model-adapter.workers-fetch.test.ts`.

### Substrate vs product discipline

Reviewers must reject any PR whose diff:

- Imports a Sage-named symbol into an `@agent-assistant/*` package.
- Adds a default tool roster, default subagent list, or default prompt
  clause that names a provider product behavior.
- Couples a primitive to a single product's flag, env var, or ID space.

### Lead/execute/review flow

Every slice follows the same agent flow:

- **Claude leads.** Claude owns the architecture contract for the slice,
  writes this plan section, defines the public type surface, and signs off
  on 80-to-100 before PR publication.
- **Codex executes.** Codex writes the production code, the unit tests, and
  the test-fix-rerun loop. Codex must self-reflect at end of each step
  (what was done, what was skipped, what is uncertain) before handing back.
- **Every agent self-reflects.** Each agent ends its turn with a short
  "what I did / what I am unsure about / what I left for the next step"
  note posted to the workflow channel. No silent handoffs.
- **Codex fresh-eyes review.** A second Codex agent (no prior turn context)
  reads the diff against this plan and posts a fresh-eyes review:
  contract-fit, dead code, missed Workers-fetch sites, missing tests.
- **Claude peer review.** Claude reads the diff, the fresh-eyes review,
  and the test output, and either accepts, requests changes, or escalates
  to the owner.
- **Claude signs off on 80-to-100.** Before PR publication, Claude verifies
  the 80-to-100 contract below has been satisfied and posts the sign-off
  decision. No PR is published without this.

## Slice 1 — Nested Subagent Runner Helper

### Deliverable

A first-party helper in `@agent-assistant/harness` that constructs a
`runSubagent` implementation for `createSubagentToolRegistry`. The helper runs
an isolated nested harness turn, preserves parent trace ids, applies the
subagent tool allowlist, and returns a flat `TaskToolResult`-compatible
result. The helper does not own selection, prompts, or roster.

### Public API contract

```ts
// packages/harness/src/nested-subagent-runner.ts

export interface CreateNestedHarnessInput {
  subagent: HarnessSubagent;
  parentContext: HarnessTurnContext;
  parentTraceId: string;
  filteredParentContext: HarnessTurnContext;
  toolAllowlist: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface ComposeNestedSubagentInstructionsInput {
  subagent: HarnessSubagent;
  taskInput: TaskToolInput;
  parentContext: HarnessTurnContext;
}

export interface CreateNestedSubagentRunnerOptions {
  createHarness(input: CreateNestedHarnessInput): HarnessRuntime;
  composeInstructions(
    input: ComposeNestedSubagentInstructionsInput,
  ): HarnessInstructions;
  now?(): string;
}

export function createNestedSubagentRunner(
  options: CreateNestedSubagentRunnerOptions,
): CreateSubagentToolRegistryOptions["runSubagent"];
```

### Behavioral requirements

- Calls `filterParentContextForSubagent` and passes the filtered context to
  `createHarness`. Never leaks the parent's full context object.
- Generates a child trace id derived from `parentTraceId` (e.g.
  `${parentTraceId}.sa-${index}`) so telemetry can correlate.
- Forwards `signal` from the parent execution context. Parent cancellation
  cancels the nested turn within one iteration boundary.
- Applies `toolAllowlist` — the nested harness must not see any tool not in
  the subagent's `allowedTools` list.
- Returns a `TaskToolResult` with `{ ok, output, error, iterations, subagent }`.
  On failure (unknown subagent, max iterations, runtime error) returns
  `ok: false` with a typed error code; never throws to the parent loop.
- Default `SUBAGENT_DEFAULT_MAX_ITERATIONS` is honored unless `taskInput`
  overrides.

### Files to change

- New: `packages/harness/src/nested-subagent-runner.ts`
- New: `packages/harness/src/nested-subagent-runner.test.ts`
- Edit: `packages/harness/src/index.ts` — export the new symbols.
- Edit: `packages/harness/src/subagent-registry.ts` — only if needed to widen
  `CreateSubagentToolRegistryOptions["runSubagent"]` typing; do not add Sage
  semantics here.

### Tests required

In `nested-subagent-runner.test.ts`:

- `success_returns_flat_result` — happy path with stub harness.
- `unknown_subagent_returns_ok_false` — registry lookup miss.
- `subagent_failure_is_isolated` — nested harness throws; parent gets
  `ok: false`, parent loop continues.
- `max_iterations_failure` — nested run exceeds limit; result reports it
  with structured reason.
- `parallel_task_batch` — two `task` invocations resolve concurrently when
  the registry advertises `executionMode: "parallel"`.
- `parent_cancellation_propagates` — abort the parent signal mid-turn;
  nested turn aborts within one iteration.
- `tool_allowlist_enforced` — nested harness offered a tool outside the
  allowlist receives no such tool in its registry snapshot.
- `parent_context_is_filtered` — nested harness sees only filtered keys;
  excluded keys (per `SUBAGENT_EXCLUDED_PARENT_KEYS`) are absent.
- `workers_fetch_compatibility` — if the runner ever resolves a fetch (it
  shouldn't, but stubbed harness may), assert no top-level capture.

## Slice 2 — Runtime Budget Policy Primitives

### Deliverable

A small policy layer in `@agent-assistant/harness` for turn-scoped enforcement.
Off by default or conservatively defaulted; emits structured events on every
intervention. No product semantics ("broad", "deep", "planner") encoded —
products inject the rules.

### Primitives

1. **Todo rewrite cap.** Configurable max number of `write_todos`-class
   calls per turn. Beyond cap, returns a successful no-op tool result with
   a "use existing plan" advisory string. Product names the tool; substrate
   does not hardcode `write_todos`.
2. **Turn-scoped tool result cache.** Keyed on `(toolName, normalizedInput)`.
   Identical calls within the same turn return cached result with
   `cacheHit: true` metadata. Product supplies the input normalizer per
   tool (default: stable JSON stringify).
3. **Reserved synthesis budget.** Configurable reserve floor `N` of the
   per-turn tool budget. Once `remainingBudget <= reserveFloor`, calls to
   tools tagged `category: "planning" | "broad"` are blocked with a
   structured advisory. Synthesis text generation always passes.
4. **Drill-or-stop validator.** After a tool result tagged
   `produces: "candidates"`, the next call to a tool tagged
   `category: "broad"` is rejected unless its input includes one of the
   prior candidate ids/paths. Product tags tools; substrate validates.
5. **Final output pseudo-tool sanitizer.** Strips tokens matching
   `/<(function_calls|invoke|parameter)\b[^>]*>[\s\S]*?<\/\1>/g` and
   markdown fences containing tool-pseudosyntax from the harness's final
   text output. Emits a structured event with stripped token classes; never
   logs raw stripped content.

### Public API contract

```ts
// packages/harness/src/runtime-policy/index.ts

export interface RuntimePolicyConfig {
  todoRewriteCap?: { toolNames: string[]; max: number };
  toolResultCache?: { enabled: boolean; normalize?: (toolName: string, input: unknown) => string };
  reserveFloor?: { floor: number; blockedCategories: readonly string[] };
  drillOrStop?: { candidateProducingTools: string[]; broadTools: string[] };
  outputSanitizer?: { enabled: boolean };
  emit?(event: RuntimePolicyEvent): void;
}

export interface RuntimePolicyEvent {
  kind:
    | "runtime_policy.blocked"
    | "runtime_policy.cache_hit"
    | "runtime_policy.todo_rewrite_blocked"
    | "runtime_policy.output_sanitized";
  turnId: string;
  toolName?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export function createRuntimePolicy(config: RuntimePolicyConfig): RuntimePolicy;

export interface RuntimePolicy {
  wrapTool(tool: HarnessToolDefinition): HarnessToolDefinition;
  sanitizeFinalOutput(text: string): { text: string; sanitized: boolean };
  reset(turnId: string): void;
}
```

### Behavioral requirements

- Defaults: every primitive is **off** unless explicitly configured. A
  consumer that does not pass `RuntimePolicyConfig` sees zero behavior change.
- All advisory results are valid `HarnessToolResult`s — never throws.
- Cache key normalization is pure and deterministic.
- Sanitizer regex is anchored, bounded, and tested against pathological
  inputs (nested tags, partial tags, code fences inside JSON strings).
- Every intervention calls `emit(event)`. Events are typed and stable.
- No knowledge of Sage tool names. The Sage repo wires its tool list into
  config at the consuming product layer.

### Files to change

- New: `packages/harness/src/runtime-policy/index.ts`
- New: `packages/harness/src/runtime-policy/cache.ts`
- New: `packages/harness/src/runtime-policy/reserve-floor.ts`
- New: `packages/harness/src/runtime-policy/drill-or-stop.ts`
- New: `packages/harness/src/runtime-policy/sanitizer.ts`
- New: `packages/harness/src/runtime-policy/*.test.ts` (one per primitive
  plus an integration test).
- Edit: `packages/harness/src/index.ts` — export the policy surface.

### Tests required

- Each primitive has unit tests covering: enabled/disabled, default no-op,
  trigger condition, advisory shape, event emission shape.
- `runtime-policy.integration.test.ts` — wraps a fake tool registry with
  the policy, runs a synthetic turn, asserts cache hits, blocked calls,
  and sanitization all fire.
- `output-sanitizer.fuzz.test.ts` — table-driven cases for nested tags,
  partial tags, code-fence interleaving, unicode in tag attributes.
- `workers-fetch.test.ts` — confirms no module-level fetch capture in any
  policy file (`grep` test or import-time spy).

## Slice 3 — Telemetry Event Vocabulary

### Deliverable

Typed event constructors and harness-bridge metadata extensions in
`@agent-assistant/telemetry` for the new substrate events. No product
dashboards, no alert thresholds, no workspace slicing.

### Event kinds

Add these kinds to the telemetry event union:

- `subagent.batch.started`
- `subagent.started`
- `subagent.finished`
- `subagent.failed`
- `runtime_policy.blocked`
- `runtime_policy.cache_hit`
- `runtime_policy.output_sanitized`
- `synthesis.salvaged`

### Payload shape (each event)

Every event carries: `{ kind, turnId, parentTraceId?, timestamp,
durationMs?, ... }`. Subagent events also carry: `{ subagentName,
childTraceId, iterations?, stopReason?, toolCallCount? }`. Policy events
carry: `{ toolName?, reason, metadata }`. Subagent names are opaque
strings — substrate does not enumerate them.

### Privacy rule

No event payload may contain raw provider message content, raw tool
inputs, or raw tool outputs. Metadata is bounded scalars and short
identifiers. Each event constructor enforces this with a runtime assertion
that rejects payloads exceeding a configurable size cap (default 4 KB).

### Files to change

- Edit: `packages/telemetry/src/index.ts` — extend the event union and
  exported constructors.
- Edit: `packages/telemetry/src/harness-bridge.ts` — propagate
  policy/subagent metadata when present on the harness trace.
- Edit: `packages/telemetry/src/sinks/memory.ts` — accept the new kinds
  without filtering.
- New: `packages/telemetry/test/subagent-events.test.ts`
- New: `packages/telemetry/test/runtime-policy-events.test.ts`
- Edit: `packages/telemetry/test/harness-bridge.test.ts` — extend with
  the new metadata.

### Tests required

- Event constructor returns frozen, schema-validated payloads.
- Oversize payloads are rejected at construction (no truncation surprise).
- Memory sink round-trips every new kind.
- Harness bridge emits policy and subagent kinds when the harness trace
  surfaces the new metadata.
- `private_content_never_leaks.test.ts` — fuzz event constructors with
  payloads containing fake message content; assert constructors strip or
  reject.

## Slice 4 — Eval Substrate

### Deliverable

A fixture-oriented eval runner for assistant turns. Decision on package
location: prefer a new `@agent-assistant/evals` if scope justifies it;
otherwise scope under `@agent-assistant/telemetry/evals`. Defer to the
implementing PR; the contract below does not depend on the choice.

### Public API contract

```ts
export interface EvalCase {
  name: string;
  fixture: { providerResponses: ProviderFixture[]; tools: ToolFixture[] };
  checks: {
    requiredEvidence?: string[];   // substrings/regexes that must appear
    forbiddenFanout?: { toolName: string; max: number }[];
    budget?: { maxToolCalls: number; maxLatencyMs: number };
    finalOutputClean?: boolean;    // sanitizer must not have triggered on real text
  };
}

export interface EvalResult {
  name: string;
  passed: boolean;
  score: { components: Record<string, number>; total: number };
  evidence: { matched: string[]; missing: string[] };
  forbiddenFanoutViolations: string[];
  budget: { toolCalls: number; latencyMs: number; cost?: number };
  finalOutputCleanResult: { clean: boolean; sanitizedKinds: string[] };
}

export function runEvalSuite(
  cases: EvalCase[],
  runner: EvalTurnRunner,
): Promise<EvalResult[]>;

export function formatPrCommentSummary(results: EvalResult[]): string;
```

### Behavioral requirements

- Runner is mockable: `EvalTurnRunner` accepts injected provider and tool
  fixtures; no network calls during eval execution.
- Result JSON is stable: field ordering is canonicalized so PR-comment
  diffs are clean.
- `formatPrCommentSummary` produces under 4 KB of markdown — collapsed
  details for failures, single-line summary for passes.
- No Sage prompts, no Sage workspace fixtures, no Sage scoring rubric in
  the package or its tests. Tests use a synthetic "echo assistant" fixture.

### Files to change

- New package skeleton (or new module): `packages/evals/` (or
  `packages/telemetry/src/evals/`).
- New: `eval-runner.ts`, `eval-checks.ts`, `pr-comment-format.ts`.
- New: matching `*.test.ts` files for each.

### Tests required

- `runEvalSuite_passes_for_synthetic_happy_path`.
- `runEvalSuite_fails_on_missing_required_evidence`.
- `runEvalSuite_fails_on_fanout_overshoot`.
- `runEvalSuite_fails_on_budget_exceed`.
- `runEvalSuite_marks_dirty_output_when_sanitizer_fires`.
- `formatPrCommentSummary_under_size_cap`.
- `formatPrCommentSummary_deterministic_ordering`.

## Slice 5 — Insight Envelope And Reader Helpers

### Deliverable

A schema-tolerant `InsightEnvelope` type plus reader helpers in
`@agent-assistant/vfs`, and projection helpers in
`@agent-assistant/turn-context` so a product can include selected insights
as prepared context blocks with provenance. Substrate decides nothing about
which insights to include or when.

### Public API contract

```ts
// packages/vfs/src/insight/envelope.ts
export interface InsightEnvelope<TBody = unknown> {
  schemaVersion: string;        // e.g. "insight/v1"
  generatedAt: string;          // ISO-8601
  sourceProvider: string;       // opaque string, no enum
  sourcePaths: string[];        // VFS paths
  freshness?: { ttlSeconds?: number; staleAt?: string };
  body: TBody;                  // product-defined, validated by product
}

export function readInsightEnvelope(
  vfs: VirtualFileSystem,
  path: string,
): Promise<InsightReadResult>;

export type InsightReadResult =
  | { ok: true; envelope: InsightEnvelope }
  | { ok: false; reason: "missing" | "malformed" | "unsupported_schema"; partial?: Partial<InsightEnvelope> };
```

```ts
// packages/turn-context/src/insight-projection.ts
export interface InsightProjectionInput {
  envelope: InsightEnvelope;
  preview?: { maxChars: number };
}

export function projectInsightAsContextBlock(
  input: InsightProjectionInput,
): PreparedContextBlock; // existing turn-context type
```

### Behavioral requirements

- `readInsightEnvelope` never throws on malformed JSON. Returns
  `{ ok: false, reason, partial }` and preserves whatever fields parsed
  cleanly.
- Provenance always survives projection: `sourceProvider`, `generatedAt`,
  and `sourcePaths` appear in the rendered context block metadata.
- Stale-data wording is **not** generated by the helper — it returns
  freshness fields and lets the product render any user-facing string.
- All file reads go through `VirtualFileSystem`; no direct `fs` access,
  no Workers-incompatible APIs.
- No `fetch` capture (insights are local; if a future variant fetches
  remote envelopes, it must use call-time `globalThis.fetch`).

### Files to change

- New: `packages/vfs/src/insight/envelope.ts`
- New: `packages/vfs/src/insight/reader.ts`
- New: `packages/vfs/src/insight/*.test.ts`
- Edit: `packages/vfs/src/index.ts` — export the insight module.
- New: `packages/turn-context/src/insight-projection.ts`
- New: `packages/turn-context/src/insight-projection.test.ts`
- Edit: `packages/turn-context/src/index.ts` — export the projector.

### Tests required

- Valid envelope round-trip.
- Missing file → `reason: "missing"`.
- Malformed JSON → `reason: "malformed"` with `partial` carrying any
  successfully parsed prefix fields.
- Unknown `schemaVersion` → `reason: "unsupported_schema"`.
- Projection preserves all provenance fields.
- Projection respects `preview.maxChars`.

## 80-To-100 Validation Contract

Each slice goes through this gate before its PR is published. Claude is the
sign-off owner; Codex executes; both review.

### 1. Targeted tests (per slice)

- Every test listed under that slice's "Tests required" section must exist
  and pass on the slice branch.
- Every new public type has at least one type-level test (compilation
  asserts via a `.types.test-d.ts` or equivalent if a tool exists in the
  repo; otherwise a runtime smoke import).

### 2. Final hard gates (deterministic, fail-fast)

Run as a single deterministic step, no agent in the loop:

- `npm run -w @agent-assistant/<pkg> typecheck`
- `npm run -w @agent-assistant/<pkg> test`
- `npm run lint -w @agent-assistant/<pkg>`
- `npm run build -w @agent-assistant/<pkg>`
- A grep gate: `! grep -rE "^(import|const).*\\bfetch\\b.*=.*$" packages/<pkg>/src` — no top-level fetch capture.
- A grep gate: `! grep -rE "(slack-researcher|competitor-researcher|github-investigator|linear-investigator|notion[_-]create[_-]page|SAGE_)" packages/<pkg>/src` — no Sage product names in substrate.

### 3. Regression suite

After per-slice gates pass, run the full repo suite:

- `npm run typecheck`
- `npm run test`
- `npm run build`

Fail the slice if any previously-green test goes red.

### 4. Review gates

In order, each blocking the next:

1. Codex self-reflection note posted on the slice channel.
2. Codex fresh-eyes review against this plan (separate Codex agent, no
   prior context). Output: APPROVE / REQUEST_CHANGES with a numbered
   diff-line list.
3. Claude peer review: reads the diff, the fresh-eyes review, and the
   final-gate output. Verifies the contract and substrate-vs-product
   discipline.
4. Claude 80-to-100 sign-off: posts `SLICE_<n>_80_100_SIGNOFF` on the
   workflow channel with a one-line decision and the SHA.

### 5. PR publication

Only after sign-off:

- Open the PR with title `feat(<pkg>): <slice title>`.
- Body links this plan and lists the gates that ran.
- PR description copies the slice's "Tests required" list as a checklist
  with each item checked.
- No `--no-verify`, no force pushes, no skipped hooks.

## Sequencing And Dependencies

- Slices 1, 2, 3, 5 are independent and can run in parallel waves.
- Slice 4 depends on the event vocabulary from Slice 3 for any shared
  metadata fields it consumes.
- Sage re-adoption (out of scope here) starts after Slices 1–5 publish a
  release.

## Acceptance For This Plan

This plan is accepted when a reader who has not seen Sage PR #208 can
read it, build any one slice in isolation, and ship it without pulling
Sage product context into Agent Assistant.

SAGE_V2_SUBSTRATE_PLAN_READY
