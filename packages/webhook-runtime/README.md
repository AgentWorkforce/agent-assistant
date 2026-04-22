# @agent-assistant/webhook-runtime

Shared webhook runtime primitives for normalizing provider events, registering local or HTTP consumers, and fanning events out consistently.

This package removes duplicated webhook plumbing that sage/nightcto/my-senior-dev all hand-roll this today.

## Quickstart

```bash
cd packages/webhook-runtime
npm install
npm run build
cat > /tmp/webhook-runtime-local-sim.mjs <<'EOF'
import {
  createWebhookRegistry, parseSlackEvent, startHttpRuntime,
} from "@agent-assistant/webhook-runtime";
const registry = createWebhookRegistry();
registry.register({
  id: "local-sim",
  kind: "local",
  provider: "slack",
  handler: (event) => console.log(event.eventType, event.payload),
});
const app = startHttpRuntime({ registry, parseSlackEvent });
console.log("local sim listening on http://localhost:3777/webhooks/slack");
await app.listen({ port: 3777 });
EOF
node /tmp/webhook-runtime-local-sim.mjs
curl -X POST http://localhost:3777/webhooks/slack -H 'content-type: application/json' -d '{"type":"event_callback","event":{"type":"app_mention","text":"ping"}}'
```

## Consumer lifecycle

`WebhookRegistry` keeps registered consumer ids in a long-lived in-memory map.
Register stable process-level consumers once at startup. If a caller creates
consumer ids dynamically, it must call `unregister(id)` when that consumer is no
longer needed or `clear()` during teardown to release the entries.
