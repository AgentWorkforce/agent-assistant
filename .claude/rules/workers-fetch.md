---
paths:
  - "packages/**/*.ts"
---

# Cloudflare Workers: never store or reference bare `fetch`

Several consumers of `@agent-assistant/*` deploy to Cloudflare Workers (cloud/specialist-worker, sage, relayfile, cataloging-agent, web). Under the `nodejs_compat` compatibility flag + esbuild bundling, a bare `fetch` identifier can be hoisted in a way that detaches it from `globalThis`. First call throws:

```
TypeError: Illegal invocation: function called with incorrect `this` reference.
See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
```

This class of bug has cost multiple production incidents already. The OpenRouter model adapter hit it on 2026-04-24, silently routing every specialist turn through `createHarness` into an `invalid` output classification and ultimately `stopReason: model_invalid_response`. Sage's own integrations hit the same thing twice before (sage#108 → sage#110 hotfix; cloud#328).

## Rule

Do **not** write this pattern anywhere a Worker consumer might import your code:

```ts
// ❌ Wrong — `fetch` is resolved at construction / module load, and
// esbuild may detach it from globalThis under nodejs_compat.
this.fetchImpl = config.fetchImpl ?? fetch;
```

Use a lambda that reads `globalThis.fetch` at **call** time instead:

```ts
// ✅ Correct — looked up fresh on every call, stays bound to globalThis,
// still overridable by tests via vi.stubGlobal("fetch", ...).
this.fetchImpl =
  config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
```

Or skip the stored impl entirely and call `globalThis.fetch(input, init)` inline at each call site:

```ts
const response = await globalThis.fetch(url, init);
```

## Why not `fetch.bind(globalThis)`?

It snapshots `fetch` at bind time, which still defeats `vi.stubGlobal("fetch", ...)` in tests (the stub replaces `globalThis.fetch`, but your bound reference points at the pre-stub implementation). The lambda variant above reads `globalThis.fetch` lazily so both prod and tests work.

## Tests

- Use `vi.stubGlobal("fetch", fetchMock)` to inject test fetches. The lambda pattern resolves `globalThis.fetch` at call time, so the stub is honoured.
- Add a regression test that imports your module from an ES-module build, stubs `globalThis.fetch`, and asserts the stub was called. Without the lambda, some bundlers will silently compile the bare `fetch` reference into something the stub can't intercept.

## Known sites this applies to today

- `packages/harness/src/adapter/openrouter-model-adapter.ts`
- `packages/harness/src/adapter/openrouter-adapter.ts`
- `packages/harness/src/router/openrouter-singleshot-adapter.ts`
- `packages/webhook-runtime/src/webhook-registry.ts`
- `packages/telemetry/src/pricing.ts`

All other fetch call sites in `packages/**` should be audited against this rule before merging.

## Related: always consume response bodies

Cloudflare Workers caps concurrent outbound HTTP requests (~6). If a `fetch()`'s resolved `Response` body is never read or cancelled, the runtime cancels older stalled responses to make room — breaking flows that relied on them. Rules:

- Happy path: `await response.json()` / `.text()` / `.arrayBuffer()` must be called.
- Error path (non-`ok`, before throwing): prefer `await response.text()` in the error message, OR call `response.body?.cancel().catch(() => {})` before the `throw`.
- Fire-and-forget: never `void fetch(...)`. Use `fetch(url, init).then((r) => { r.body?.cancel().catch(() => {}); }).catch(logger.warn)` so both branches are handled.

## Reference PRs

- cloud#328 — hotfix specialist-worker fetch detachment
- sage#110 — first Illegal-invocation incident
- sage#115 — stalled-response body-consumption pass
- (this PR) — harness + webhook-runtime + telemetry
