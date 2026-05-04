# Ricky Harness v0.6/v0.7 Implementation Notes

This slice extends the existing v0.5 harness work with additive v0.6 and v0.7 behavior from `docs/specs/v0.5-harness-improvements.md`. The implementation keeps current imports working, preserves the Cloudflare Workers fetch rule, and makes every new behavior opt-in except observability settlement improvements.

## v0.6

Direct provider model adapters were added under `packages/harness/src/adapter/` for Anthropic, OpenAI, and Gemini. Each adapter implements `HarnessModelAdapter`, uses a call-time `globalThis.fetch` fallback, forwards `AbortSignal`, consumes provider response bodies through `response.text()`, maps provider errors to stable `HarnessInvalidOutputCode` values, and normalizes text, refusal, and tool-call responses into `HarnessModelOutput`. Shared parsing and error helpers live in `provider-error-mapping.ts`. The conformance tests cover text, tool-use, refusal, provider errors, call-time global fetch stubbing, abort propagation, abort error mapping, and error-body consumption for the direct providers.

Tool batches now emit `tool_batch_started` and inspect `HarnessToolDefinition.executionMode`. The default remains sequential. A batch only runs concurrently when every requested tool is marked `executionMode: "parallel"`, and results are processed in completion order so the redundant-loop detector sees the actual completion sequence. Parallel sibling calls are allowed to finish before harness-level error handling decides whether to continue, defer, or fail.

Tool results can now opt into `terminate: true`. The harness treats termination as an all-or-nothing batch contract: every result in the batch must be a successful terminating result. When that condition holds, the harness records the tool results, emits normal tool-finished trace events, appends a synthetic final-answer transcript item, and returns `answer_finalized` without an additional model round trip.

## v0.7

Subpath export hygiene was added with `@agent-assistant/harness/registries`, `@agent-assistant/harness/router`, and `@agent-assistant/harness/prompt`, alongside the existing MCP, agent-relay, worker-bridge, and proof subpaths. Root imports remain compatible. Root-level compatibility wrappers now emit one deprecation warning per legacy function symbol for registry, router, and prompt helpers while forwarding to the existing implementations. Constants, classes, and types remain available for backward compatibility.

`HarnessHooks.transformTranscript` now runs immediately before each model call. The hook receives a copy of the full execution transcript and may return the per-iteration transcript visible to the model. The canonical `state.transcript` remains unchanged for trace, hooks, continuations, and final results. If the hook throws or returns a non-array value, the harness logs a warning and falls back to the untransformed transcript.

Evidence density failures now populate `HarnessResult.metadata.evidenceDensity` with claim count, evidence units, a finite ratio, and the violating claim markers when `stopReason` is `evidence_density_violation`. This is derived from the existing `exceedsEvidenceBudget` verdict rather than re-running a separate detector downstream. `ExecutionNegotiationReason` also accepts optional `metadata`, so adapter layers can carry the same payload in degradation entries without widening through untyped casts.

Trace settlement is now explicit in the `HarnessTraceSink` contract. The harness awaits every trace emit in order, swallows trace sink failures so execution semantics survive observability failures, emits `turn_finished` during finalization, and awaits optional `trace.flush()` before `runTurn` resolves.

## Validation

Validation completed with:

```bash
npm run typecheck -w @agent-assistant/harness
npm test -w @agent-assistant/harness -- src/harness.test.ts src/adapter/direct-provider-model-adapters.test.ts src/subpath-exports.test.ts
npm run build -w @agent-assistant/harness
npm test -w @agent-assistant/harness
```

The focused v0.6/v0.7 subset passed with 3 test files and 59 tests after this pass. The full harness suite passed with 34 test files and 342 tests.

V0_6_V0_7_SLICES_IMPLEMENTED
