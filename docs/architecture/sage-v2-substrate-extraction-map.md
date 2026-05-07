# Sage v2 Substrate Extraction Map

Date: 2026-05-07

Status: IMPLEMENTATION_READY for follow-up specs and code PRs.

Source product proof: AgentWorkforce/sage PR [#208](https://github.com/AgentWorkforce/sage/pull/208).

## Purpose

Sage PR #208 proves a new product need: Sage should act as an orchestrator that can assemble tools, skills, and subagents for messy real work. Some of that work is Sage product intelligence. Some of it is reusable Agent Assistant substrate.

This document maps what should trace from Sage back into Agent Assistant, what must remain Sage-owned, and the follow-up PR series that should extract reusable pieces without turning Agent Assistant into a Sage-specific runtime.

## Extraction Decision

Roughly 35-45% of PR #208 should trace back into Agent Assistant.

The trace-back is not a direct port. Sage should keep the product behavior that makes Sage distinct. Agent Assistant should absorb only the contracts and runtime primitives that multiple assistant products can reuse.

Use the existing ownership rule from `runtime-primitives-vs-product-intelligence.md`:

- If the behavior is a reusable execution, policy, telemetry, evidence, or context primitive, it belongs in Agent Assistant.
- If the behavior encodes Sage's domain, workflows, prompts, tool roster, or UX judgment, it belongs in Sage.

## What Moves To Agent Assistant

### 1. Nested subagent runner substrate

Current state:

- `@agent-assistant/harness` already exposes `HarnessSubagent`, `createSubagentToolRegistry`, and the `task` tool contract.
- `@agent-assistant/harness` already supports opt-in parallel tool batches through `HarnessToolDefinition.executionMode`.
- Sage PR #208 fills the missing product-side gap by adding a default nested harness runner around that registry.

Reusable extraction:

- Add a first-party helper that constructs a `runSubagent` implementation for `createSubagentToolRegistry`.
- The helper should run an isolated nested harness turn, preserve parent trace ids, apply the subagent tool allowlist, and return only a flat `TaskToolResult`-compatible output.
- The helper must not own subagent selection, product prompts, model policy, or domain-specific tool lists.

Likely package:

- `@agent-assistant/harness`

Possible public shape:

```ts
export interface CreateNestedSubagentRunnerOptions {
  createHarness(input: CreateNestedHarnessInput): HarnessRuntime;
  composeInstructions(input: ComposeNestedSubagentInstructionsInput): HarnessInstructions;
  now?(): string;
}

export function createNestedSubagentRunner(
  options: CreateNestedSubagentRunnerOptions,
): CreateSubagentToolRegistryOptions["runSubagent"];
```

The exact API can change during implementation, but the ownership rule should not: Agent Assistant provides the runner mechanism; products provide the roster, prompts, and tool policy.

### 2. Runtime budget policy primitives

Sage's new runtime specs identify problems that are not Sage-specific:

- repeated todo rewrites,
- repeated identical tool calls,
- broad search/list loops after concrete candidates exist,
- tool-call budgets exhausted before synthesis,
- final text leaking pseudo-tool syntax.

Reusable extraction:

- Add a small runtime policy layer for turn-scoped enforcement.
- It should be configurable and off by default or conservatively defaulted so existing harness consumers do not change behavior unexpectedly.
- It should expose structured events when it blocks, caches, or sanitizes output.

Likely package:

- `@agent-assistant/harness`

Initial primitives:

- todo rewrite cap,
- turn-scoped tool-result cache,
- reserved synthesis budget,
- drill-or-stop validator,
- final output pseudo-tool sanitizer.

Product-owned pieces:

- what counts as "broad" for a product,
- which tools are planning tools,
- which providers and paths are high priority,
- final answer style when budget is exhausted.

### 3. Subagent and specialist telemetry schema

Sage v2 adds parent, task subagent, specialist, sandbox, and write workflows. The lifecycle events should become reusable telemetry vocabulary.

Reusable extraction:

- Add typed telemetry event helpers for parent/subagent/specialist lifecycle events.
- Extend the harness telemetry bridge to include subagent and policy metadata where available.
- Keep raw private provider content out of telemetry by default.

Likely package:

- `@agent-assistant/telemetry`

Initial event kinds:

- `subagent.batch.started`
- `subagent.started`
- `subagent.finished`
- `subagent.failed`
- `runtime_policy.blocked`
- `runtime_policy.cache_hit`
- `runtime_policy.output_sanitized`
- `synthesis.salvaged`

Product-owned pieces:

- dashboards,
- alert thresholds,
- customer/workspace-specific slicing,
- product-specific scoring rubrics.

### 4. Evaluation harness substrate

Sage needs evals for orchestration quality, but the runner and result format can be shared.

Reusable extraction:

- Define a fixture-oriented eval runner contract for assistant turns.
- Emit JSON suitable for PR comments and dashboards.
- Support deterministic checks for required evidence, forbidden fanout, budget limits, and final-output sanitation.

Likely package:

- A future `@agent-assistant/evals` package, or an internal `packages/telemetry` subpath if the first slice is small.

Product-owned pieces:

- Sage eval prompts,
- Sage workspace fixtures,
- Sage scoring thresholds,
- Sage-specific expected evidence paths.

### 5. Insight context contracts

Sage wants `/insights/*` artifacts from catalogers to become first-class context. The envelope and reader helpers are reusable, but the product decides how to use them.

Reusable extraction:

- Define a schema-tolerant `InsightEnvelope`.
- Add helper types for source paths, generated timestamps, freshness, and source-provider metadata.
- Provide reader helpers that preserve provenance and fail gracefully on partial JSON.

Likely packages:

- `@agent-assistant/vfs` for artifact contracts and path helpers.
- `@agent-assistant/turn-context` for projecting selected insights into prepared context.

Product-owned pieces:

- which insight paths to check,
- whether an insight is relevant to a user turn,
- fallback ordering between insights and raw provider records,
- product-specific stale-data wording.

## What Stays In Sage

These pieces should not be moved into Agent Assistant:

- Sage's `slack-researcher`, `competitor-researcher`, `github-investigator`, `linear-investigator`, `planner`, and `doc-drafter` roster definitions.
- Sage subagent system prompts.
- Sage's Slack-to-Notion competitor research workflow.
- Sage's dynamic harness assembly rules for Slack, Notion, GitHub, Linear, and memory.
- Sage-specific environment flags such as `SAGE_HARNESS_SUBAGENTS_ENABLED`.
- Sage product prompt clauses, tone, and delegation heuristics.
- The open-issue bundle and Sage v2 product roadmap specs.

## Follow-Up PR Series

### PR 1: Nested subagent runner helper

Package:

- `@agent-assistant/harness`

Acceptance:

- A product can create a `task` tool with `createSubagentToolRegistry` and a first-party nested runner helper.
- The nested runner starts a fresh harness turn with filtered parent context.
- The subagent sees only its allowlisted tools.
- Parent cancellation cancels nested turns.
- Tests prove success, unknown subagent, subagent failure, max-iteration failure, and parallel task batches.

### PR 2: Runtime budget policy

Package:

- `@agent-assistant/harness`

Acceptance:

- Duplicate tool calls can return cached turn-scoped results.
- Todo rewrites can be capped.
- Reserve-floor policy can stop broad tool calls while allowing synthesis.
- Drill-or-stop policy can reject repeated broad listing after candidate results.
- Output sanitizer removes raw pseudo-tool XML from final text.
- Every policy intervention emits a structured trace or telemetry event.

### PR 3: Telemetry event vocabulary

Package:

- `@agent-assistant/telemetry`

Acceptance:

- Typed event constructors exist for subagent lifecycle and runtime policy events.
- Harness bridge can include policy/subagent metadata without logging raw private content.
- Memory and console sinks can receive the new events.
- Tests assert event shape stability.

### PR 4: Eval runner substrate

Package:

- Future `@agent-assistant/evals` or a scoped telemetry/evals module.

Acceptance:

- A local fixture runner can execute assistant turn cases with mocked providers.
- Result JSON includes pass/fail, score components, required evidence checks, forbidden behavior checks, cost, latency, and tool-call counts.
- The runner can produce a compact PR-comment summary.

### PR 5: Insight envelope and reader helpers

Packages:

- `@agent-assistant/vfs`
- `@agent-assistant/turn-context`

Acceptance:

- `InsightEnvelope` parses valid and partial artifacts.
- Reader helpers preserve `generatedAt`, `sourceProvider`, and `sourcePaths`.
- Turn-context can accept selected insights as prepared context blocks with provenance.
- Tests prove malformed insight JSON fails gracefully.

### PR 6: Sage re-adoption

Package:

- Sage consumes the new Agent Assistant release.

Acceptance:

- Sage deletes or simplifies its local nested subagent runner.
- Sage keeps its product-specific subagent roster and prompts.
- Sage preserves the behavior added in PR #208.
- Sage regression tests continue to pass.

## Non-Goals

- Do not move Sage product workflows into Agent Assistant.
- Do not make `@agent-assistant/harness` a general autonomous swarm engine.
- Do not force every assistant product to use subagents.
- Do not add Slack, Notion, GitHub, or Linear product semantics to shared packages.
- Do not block Sage PR #208 on this extraction; PR #208 is the product proof that motivates the substrate work.

## Success Criteria

This extraction is successful when:

- Sage can keep improving its v2 product behavior without duplicating generic harness machinery.
- Other products can reuse nested subagent execution, budget policy, telemetry, eval, and insight primitives without importing Sage concepts.
- Agent Assistant remains a runtime substrate, not a product brain.
- The reusable API surface is smaller than Sage's product implementation.

SAGE_V2_SUBSTRATE_EXTRACTION_MAP_READY
