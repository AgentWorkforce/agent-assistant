# @agent-assistant/dispatch

TypeScript contract types for proactive persona dispatch requests and responses in Agent Assistant. The exported dispatch envelope follows canonical spec section 7.2: https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#72-dispatch-envelope.

The response union covers the synchronous, sandbox-borrow, async callback, and error outcomes from canonical spec section 7.5: https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback.

```ts
import type { DispatchEnvelope, DispatchResponse } from "@agent-assistant/dispatch";

const envelope: DispatchEnvelope<{ cron: string }> = {
  type: "cron.tick",
  personaId: "morning-briefing",
  workspaceId: "workspace-1",
  deploymentId: "deployment-1",
  occurredAt: new Date().toISOString(),
  envelope: {
    id: "evt-1",
    payload: { cron: "0 8 * * 1-5" },
  },
};

const response: DispatchResponse = {
  kind: "done",
  delivery: [{ kind: "slack.message", text: "Briefing ready" }],
};
```
