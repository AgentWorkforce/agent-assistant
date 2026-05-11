# Proactive Runtime Interop

This note explains how the OSS `@agent-assistant/*` packages fit with a hosted proactive runtime.

## The Split

`@agent-assistant/proactive` stays in-process and single-agent. It owns follow-up engines, watch rule evaluation, and the thin `SchedulerBinding` seam that lets a caller request wake-ups from inside one handler. It does not own durable triggers, cross-process orchestration, product routing, or any hosted control plane.

The proactive runtime is the cloud layer above that package. It is the durable, cross-process, multi-trigger surface that receives trigger events, persists wake-ups, and invokes your agent handler when something meaningful happens. In short: the runtime gives you the trigger; `@agent-assistant` gives you the stateful assistant logic you run when that trigger fires.

## What Belongs Where

Use `@agent-assistant/proactive` for:

- follow-up engines
- watch rule evaluation
- scheduler adapter contracts
- assistant-session-aware logic that runs inside one handler invocation
- stateful conversation and follow-up logic once the agent is awake

Use the proactive runtime for:

- durable trigger delivery
- cross-process wake-ups
- multi-trigger fan-in
- hosted scheduling and dispatch
- long-lived runtime state outside a single handler process

## Recommended Integration Pattern

Inside the `onEvent` handler, treat the runtime event as the reason to wake the assistant, not as a replacement for assistant state. Build or recover an assistant session, then run the normal `@agent-assistant` logic against that session.

The small helper in `@agent-assistant/proactive` exists for exactly this bridge:

```ts
import { agent } from '@agent-relay/agent';
import {
  createProactiveEngine,
  fromContext,
  InMemorySchedulerBinding,
} from '@agent-assistant/proactive';
import { createSessionStore, InMemorySessionStoreAdapter } from '@agent-assistant/sessions';

const sessions = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

const schedulerBinding = new InMemorySchedulerBinding();
const engine = createProactiveEngine({ schedulerBinding });

await agent({
  workspace: 'your-workspace',
  schedule: '*/5 * * * *',
  onEvent: async (ctx, event) => {
    const aaSession = fromContext(ctx);

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
      lastActivityAt: session.lastActivityAt,
    });

    for (const decision of decisions) {
      if (decision.action === 'fire') {
        // Your runtime owns the actual delivery surface.
        await deliverFollowUp(decision, session);
      }
    }
  },
});
```

## Why `fromContext` Exists

Runtime contexts usually carry a workspace identifier and an agent identifier, but not an `@agent-assistant/sessions` input shape. `fromContext(ctx)` turns that runtime context into a stable assistant-session descriptor keyed on `(workspace, agentId)`. It scopes the session `id`, `userId`, and `surfaceId` to that tuple so the same agent name in two workspaces does not collapse into one affinity bucket. That keeps the session identity consistent across separate runtime wake-ups without forcing every consumer to hand-roll the same mapping.

Use it when the runtime decides *when* to wake the agent, and `@agent-assistant` decides *how* that agent continues the conversation, evaluates follow-up rules, or resumes watch logic.

The helper is intentionally structural and cloud-agnostic:

- it accepts either `ctx.workspaceId` or `ctx.workspace.id`
- it accepts either `ctx.agentId` or `ctx.agent.id`
- it derives a stable assistant identity from `(workspace, agentId)`
- it does not import any hosted runtime package

That preserves the OSS rule that cloud layers may depend on `@agent-assistant/*`, but OSS packages do not depend on cloud layers.
