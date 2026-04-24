# OpenRouter Adapter Robustness

## Summary

`@agent-assistant/harness` needs one OpenRouter model adapter that translates provider response shapes into the harness contract without owning product routing policy. The adapter should normalize response shapes, classify the canonical result, parse tool-call arguments safely, preserve reasoning as trace metadata, and retry transient transport/provider failures once before returning `invalid`.

This preserves the governing rule in `HARNESS_RECOMMENDATIONS.md:3-5`: separate product identity from execution. The adapter translates shapes. It does not choose models, orchestrate tasks, or apply per-product policy.

## Base Parsing Flow Audit

On `origin/main` before this PR, `packages/harness/src/adapter/openrouter-model-adapter.ts` built a Chat Completions request from system/developer/context/transcript/user messages and optional OpenAI-style tool descriptors (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:173-205`). The request body did not set reasoning-specific fields; this PR keeps that unchanged (`packages/harness/src/adapter/openrouter-model-adapter.ts:196-227`).

The base adapter made one `fetch` call, parsed `response.json()`, and returned `invalid` immediately for any non-2xx HTTP status (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:241-271`). It then read only `body.choices?.[0]?.message` (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:274-286`). If `message.tool_calls` existed, it parsed each `function.arguments` with `JSON.parse` and returned `tool_request`; malformed JSON returned `invalid` with a string reason (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:288-301`). If there were no tool calls, it trimmed `message.content` and returned `final_answer`; empty content returned `invalid` (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:304-314`). Timeouts and thrown fetch errors were also returned as `invalid` (`origin/main:packages/harness/src/adapter/openrouter-model-adapter.ts:315-323`).

The harness consumes invalid outputs by incrementing `consecutiveInvalidOutputs`, calling `hooks.onInvalidModelOutput`, and eventually failing with `model_invalid_response` when the configured invalid-output limit is reached (`packages/harness/src/harness.ts:391-410`). Before this PR, `HarnessInvalidOutput` only exposed `reason`, `raw`, and `usage` (`origin/main:packages/harness/src/types.ts:140-145`).

## Response Shapes

OpenRouter documents reasoning tokens as a normalized provider feature, and says supported models can return thinking tokens in each message's `reasoning` field unless excluded; it also documents a request-side `reasoning` parameter for enabling or tuning reasoning. See OpenRouter reasoning docs: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.

Claude with thinking through Chat Completions can therefore arrive as a normal assistant message with `reasoning`, `content`, and optional `tool_calls`:

```json
{
  "choices": [{
    "message": {
      "reasoning": "Need repository facts before answering.",
      "content": null,
      "tool_calls": [{
        "id": "call_1",
        "type": "function",
        "function": { "name": "search", "arguments": "{\"query\":\"repo\"}" }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

The adapter also defensively strips inline `<thinking>...</thinking>` from `message.content`. That shape is not the preferred OpenRouter contract, but it has appeared in provider/proxy behavior and must not be conflated with final answer content.

OpenAI reasoning models via the Responses API represent reasoning as `output` items with `type: "reasoning"` and tool calls as `type: "function_call"`. OpenAI documents reasoning item summaries/content and function-call items in the Responses API reference: https://developers.openai.com/api/reference/resources/responses/methods/create. OpenRouter also exposes a Responses API beta with a `reasoning` request field: https://openrouter.ai/docs/api/reference/responses/reasoning.

```json
{
  "id": "resp_123",
  "output": [
    {
      "type": "reasoning",
      "summary": [{ "type": "summary_text", "text": "Need to inspect the workspace." }]
    },
    {
      "type": "function_call",
      "call_id": "call_workspace",
      "name": "workspace_search",
      "arguments": "{\"query\":\"open prs\"}"
    }
  ]
}
```

Non-reasoning models remain the ordinary Chat Completions shape:

```json
{
  "choices": [{
    "message": {
      "content": "Final answer.",
      "tool_calls": []
    }
  }]
}
```

## Proposed Adapter Architecture

The implemented adapter has three layers:

1. `responseToCanonical(body)` normalizes Chat Completions and Responses-like shapes into `{ toolCalls, content, reasoning, rawReasoningBlocks, metadata }` (`packages/harness/src/adapter/openrouter-model-adapter.ts:386-416`). It reads `message.reasoning`, `message.reasoning_content`, `body.output_reasoning_summary`, Responses-style `output` reasoning items, and inline `<thinking>` tags. It also reads Chat Completions `message.tool_calls` and Responses-style `output[].type === "function_call"` tool calls (`packages/harness/src/adapter/openrouter-model-adapter.ts:352-379`).
2. `classifyCanonicalResponse` chooses `tool_request` when tool calls exist, `final_answer` when usable content exists, and enriched `invalid` otherwise (`packages/harness/src/adapter/openrouter-model-adapter.ts:479-528`). Reasoning is attached to output metadata with raw reasoning blocks for trace/debug use (`packages/harness/src/adapter/openrouter-model-adapter.ts:418-429`).
3. `parseToolCallInput` accepts object arguments or JSON strings that parse to objects. Malformed JSON, arrays, and primitive arguments classify as `schema_mismatch` instead of becoming generic invalid output (`packages/harness/src/adapter/openrouter-model-adapter.ts:458-468`).

## Failure Modes And Retry Policy

Transient failures are HTTP `408`, `409`, `425`, `429`, any `5xx`, abort timeouts, and fetch/network exceptions. The adapter retries these once internally with a small backoff before surfacing `kind: "transient"` (`packages/harness/src/adapter/openrouter-model-adapter.ts:445-456`, `packages/harness/src/adapter/openrouter-model-adapter.ts:549-567`, `packages/harness/src/adapter/openrouter-model-adapter.ts:589-613`). This prevents one OpenRouter blip from consuming the harness invalid-output budget.

Structural failures are `schema_mismatch`, `empty_response`, and `missing_message`. They should count against `maxConsecutiveInvalidModelOutputs`, allowing the harness to re-prompt or re-loop according to its existing invalid-output behavior.

Unrecoverable/provider failures are `provider_error` for missing API keys, non-transient HTTP errors, invalid JSON response bodies, and impossible adapter-loop fallthroughs (`packages/harness/src/adapter/openrouter-model-adapter.ts:550-552`, `packages/harness/src/adapter/openrouter-model-adapter.ts:589-604`, `packages/harness/src/adapter/openrouter-model-adapter.ts:566`).

Model refusals are classified as `model_refused` when the provider exposes a refusal field (`packages/harness/src/adapter/openrouter-model-adapter.ts:487-493`). This is a richer invalid-output event today; a future change can map provider refusals to the harness `refusal` output type if consumers want `stopReason: "model_refused"` directly.

## Hook Payload Upgrade

`HarnessInvalidOutput` is now additive and backward-compatible: existing `reason` and `raw` remain, while `kind`, `httpStatus`, `retriedAt`, and `metadata` are optional (`packages/harness/src/types.ts:140-161`). The hook signature remains unchanged (`packages/harness/src/types.ts:447-450`), so existing consumers keep compiling. Consumers should prefer `output.kind` over string matching `output.reason`.

When an invalid output exhausts the harness invalid-output limit, the final result metadata now includes `reason` plus optional `kind`, `httpStatus`, and `retriedAt` (`packages/harness/src/harness.ts:401-410`). Invalid assistant transcript steps preserve invalid-output metadata as trace context (`packages/harness/src/harness.ts:574-585`).

## Consumer Audit

Sibling-repo grep found `createOpenRouterModelAdapter` consumers in cloud specialist worker and Sage, but no runtime `onInvalidModelOutput` consumers in cloud or Sage. Cloud calls the adapter in `packages/specialist-worker/src/specialist/github-specialist-agentic.ts:114` and `packages/specialist-worker/src/specialist/linear-specialist-agentic.ts:83`. Sage calls it in `src/swarm/specialist/github-specialist-agentic.ts:76`, `src/swarm/specialist/linear-specialist-agentic.ts:73`, and `src/harness/slack-runner.ts:220`. The only `onInvalidModelOutput` runtime hook is the harness hook itself; Sage references it only in docs/workflow specs.

This supports a non-breaking patch release. The payload is enriched, not renamed. No consumer must change immediately, but cloud should follow with logging that prints `kind`, `httpStatus`, and `retriedAt`.

## Migration Plan

1. Ship this as a non-breaking `@agent-assistant/harness` patch: no request-body changes, no per-model adapters, no hook signature break.
2. Publish or otherwise make the package available to cloud after review.
3. In cloud, bump `@agent-assistant/harness`, update specialist invalid-output logging to include `kind`, `httpStatus`, and `retriedAt`, and add a model config entry for `openai/gpt-5.5`.
4. If production traces show OpenRouter returns a stable cleaner reasoning shape only when a request flag is set, add that request flag in a separate PR and document it. This PR intentionally does not change the request body.

## Verification

The new tests cover:

- Claude `message.reasoning` plus tool calls (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:268-304`)
- inline `<thinking>` plus tool calls (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:306-336`)
- GPT-5.5/Responses-style reasoning and function calls (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:338-369`)
- transient 503 retry success and retry failure (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:371-412`)
- malformed tool-call JSON as `schema_mismatch` (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:209-236`)
- empty content as `empty_response` (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:252-266`)
- missing message as `missing_message`, provider errors, timeout/transient, and model refusal (`packages/harness/src/adapter/openrouter-model-adapter.test.ts:139-176`, `packages/harness/src/adapter/openrouter-model-adapter.test.ts:196-207`, `packages/harness/src/adapter/openrouter-model-adapter.test.ts:238-250`, `packages/harness/src/adapter/openrouter-model-adapter.test.ts:414-428`)
