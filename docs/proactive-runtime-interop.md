# Proactive Runtime Interop

This note explains the split between the OSS `@agent-assistant/*` packages and a hosted proactive runtime, and shows the recommended recipe for using them together.

## The Split

`@agent-assistant/proactive` is the in-process layer. It stays inside one handler invocation and one assistant. It owns follow-up engines, watch-rule evaluation, and scheduler bindings that request another wake-up from inside the handler.

The proactive runtime is the durable cloud layer. It owns cross-process triggers, multi-trigger fan-in, durable delivery, retry, and the hosted control plane that decides when your handler should wake up.

The shorthand is:

- `@agent-assistant/proactive` = in-process follow-up engines, watch rules, and scheduler bindings
- proactive runtime = cross-process, multi-trigger, durable trigger surface

Use `@agent-assistant` inside `onEvent`. The runtime gives you the trigger. `@agent-assistant` gives you the stateful conversation and follow-up logic that runs after the wake-up.

## What Belongs Where

Use `@agent-assistant/proactive` for:

- follow-up engines
- watch-rule evaluation
- scheduler binding contracts
- assistant-session-aware logic inside one handler
- stateful conversation and follow-up logic after wake-up

Use the proactive runtime for:

- durable trigger delivery
- cross-process wake-ups
- multi-trigger fan-in
- hosted scheduling and dispatch
- long-lived runtime state outside a single process

## Recipe: Use Agent Assistant Inside `onEvent`

Treat the runtime event as the reason to wake the assistant, not as a replacement for assistant state. Inside `onEvent`, recover or create an `@agent-assistant/sessions` session, then run the normal proactive engine or follow-up logic against that session.

```ts
import { agent } from '@agent-relay/agent';
import {
  ContextSchedulerBinding,
  createProactiveEngine,
  fromContext,
} from '@agent-assistant/proactive';
import {
  createSessionStore,
  ctxFilesToRuntimeSessionStoreAdapterOptions,
  RuntimeSessionStoreAdapter,
} from '@agent-assistant/sessions';

await agent({
  workspace: 'your-workspace',
  schedule: '*/5 * * * *',
  onEvent: async (ctx, event) => {
    const sessions = createSessionStore({
      adapter: new RuntimeSessionStoreAdapter(
        ctxFilesToRuntimeSessionStoreAdapterOptions(ctx.files, {
          signal: ctx.signal,
        }),
      ),
    });
    const engine = createProactiveEngine({
      schedulerBinding: new ContextSchedulerBinding(ctx),
    });
    const aaSession = fromContext(ctx);
    ctx.signal.throwIfAborted?.();

    const session =
      (await sessions.get(aaSession.id)) ??
      (await sessions.create({
        id: aaSession.id,
        userId: aaSession.userId,
        workspaceId: aaSession.workspaceId,
        initialSurfaceId: aaSession.initialSurfaceId,
        metadata: aaSession.metadata,
      }));

    const decisions = await engine.evaluateFollowUp({
      sessionId: session.id,
      scheduledAt: new Date().toISOString(),
      lastActivityAt: session.lastActivityAt ?? session.createdAt ?? new Date().toISOString(),
    });
    ctx.signal.throwIfAborted?.();

    for (const decision of decisions) {
      if (decision.action === 'fire') {
        await ctx.once(`followup:${session.id}:${decision.ruleId}:${event.id}`, async () => {
          await deliverFollowUp(decision, session, ctx.signal);
        });
      }
    }
  },
});
```

That keeps responsibilities clean:

- the runtime decides when the handler wakes up
- `fromContext(ctx)` gives you a stable assistant-session key
- `@agent-assistant/sessions` preserves continuity across wake-ups
- `@agent-assistant/proactive` decides what follow-up should happen next

### `deliverFollowUp` Responsibility

`deliverFollowUp(decision, session)` is product-owned. A minimal implementation is:

```ts
async function deliverFollowUp(
  decision: FollowUpDecision,
  session: Session,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted?.();
  await sendAssistantMessage({
    sessionId: session.id,
    text: decision.messageTemplate ?? 'Following up on your request.',
    metadata: {
      ruleId: decision.ruleId,
      routingHint: decision.routingHint,
    },
  });
  signal?.throwIfAborted?.();
}
```

The runtime does not provide this helper because the delivery surface differs by product. Some products write back into relaycast, some enqueue a hosted assistant turn, and some persist a task for a later human review queue.

### Durable Session Storage

The recipe uses `RuntimeSessionStoreAdapter` so assistant-session continuity survives cold starts. `ctxFilesToRuntimeSessionStoreAdapterOptions(ctx.files, { signal: ctx.signal })` is the shared bridge helper for that wiring, which avoids re-implementing the same `read/write/list/delete` adapter glue in every hosted runtime. `InMemorySessionStoreAdapter` is still useful for tests and single-process demos, but production proactive-runtime handlers should back `@agent-assistant/sessions` with `ctx.files` or another durable store.

## Why `fromContext` Exists

Runtime contexts usually contain a workspace identifier and an agent identifier, but not the shape that `@agent-assistant/sessions` wants. `fromContext(ctx)` converts that runtime context into a stable assistant-session descriptor keyed on `(workspace, agentId)` so consumers do not have to hand-roll the mapping.

The helper returns:

- `id` for the session id
- `userId` scoped to the agent tuple
- `workspaceId`
- `surfaceId` as a convenience alias for the runtime-facing attachment id
- `initialSurfaceId` for `sessions.create(...)`, which is the field the session
  store consumes when attaching the first surface
- `metadata` with the runtime source and stable session key

That keeps the same agent in two different workspaces from collapsing into one session bucket, and it keeps repeat wake-ups for the same `(workspace, agentId)` pair attached to the same assistant session identity.

## Helper Contract

`fromContext` is intentionally structural and cloud-agnostic:

- it accepts either `ctx.workspaceId` or `ctx.workspace.id`
- it also accepts the canonical runtime shape `ctx.workspace: string` with `ctx.agentId: string`
- it accepts either `ctx.agentId` or `ctx.agent.id`
- it trims blank ids and prefers the first valid value
- it derives a stable assistant identity from `(workspace, agentId)`
- it does not import any hosted runtime package

That preserves the OSS boundary: cloud layers may depend on `@agent-assistant/*`, but OSS packages here do not depend on the hosted runtime.

## Identity Semantics

When the hosted runtime only exposes `ctx.workspace` as a human-readable
workspace name, `fromContext(ctx)` uses that value as the stable
`workspaceId`. That keeps the helper structural and runtime-agnostic, but it
means renaming a workspace changes the derived session id and therefore starts
a fresh assistant session. Hosted runtimes that need rename-stable continuity
should pass a durable `ctx.workspaceId` instead of only `ctx.workspace`.

## Delivery Guarantees

The hosted runtime delivers wake-up events with at-least-once semantics, so
`evaluateFollowUp()` and the follow-up side effects around it must be safe under
redelivery. The recommended pattern is:

- use `ctx.once(...)` or an equivalent runtime idempotency primitive around the
  outward side effect
- key that idempotency scope with the assistant session id, the follow-up rule
  id, and the runtime event id
- treat repeated `evaluateFollowUp()` calls as expected after retry or reconnect

The recipe above follows that pattern with
`followup:${session.id}:${decision.ruleId}:${event.id}` so the engine may be
re-run while the externally visible follow-up is still deduplicated.
