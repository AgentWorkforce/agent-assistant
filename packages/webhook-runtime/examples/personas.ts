import {
  registerSlackSpecialistConsumer,
  type WebhookRegistry,
} from "../src/index.js";
import type { NormalizedWebhook } from "../src/index.js";

export type Persona = {
  id: string;
  description: string;
  register(registry: WebhookRegistry): void;
};

function logEgress(consumerId: string, event: NormalizedWebhook, response: unknown): void {
  const rendered =
    typeof response === "string" ? response : JSON.stringify(response);
  console.log(
    `[${consumerId}] channel=${String(event.data?.channel ?? "?")} eventType=${event.eventType} -> ${rendered}`,
  );
}

export const personaCatalog: Record<string, Persona> = {
  echo: {
    id: "echo",
    description:
      "kind:local baseline. Logs the normalized event so you can see exactly what parseSlackEvent produced. No predicate, fires on every Slack event.",
    register(registry) {
      registry.register({
        id: "echo",
        kind: "local",
        provider: "slack",
        handler: (event) => {
          console.log(
            `[echo] eventType=${event.eventType} workspaceId=${String(
              event.workspaceId ?? "?",
            )} data=${JSON.stringify(event.data)}`,
          );
        },
      });
    },
  },

  "github-stub": {
    id: "github-stub",
    description:
      "Specialist consumer with a stub factory. Predicate: app_mention only. Egress logs to console. Use to see specialist-bridge wiring without invoking any real specialist.",
    register(registry) {
      registerSlackSpecialistConsumer(registry, {
        id: "github-stub",
        specialistKind: "github",
        predicate: (event) => event.eventType === "app_mention",
        egress: ({ consumerId, event, response }) =>
          logEgress(consumerId, event, response),
        specialistFactory: ({ event }) => ({
          handler: {
            async execute() {
              return `[github-stub] would handle: ${String(event.data?.text ?? "")}`;
            },
          },
        }),
      });
    },
  },

  "github-real": {
    id: "github-real",
    description:
      "Specialist consumer with NO factory override. Falls through to the default dynamic import of @agent-assistant/specialists (createGitHubLibrarian). Exercises the real SDK default path. Requires the specialists package to be buildable/runnable.",
    register(registry) {
      registerSlackSpecialistConsumer(registry, {
        id: "github-real",
        specialistKind: "github",
        predicate: (event) => event.eventType === "app_mention",
        egress: ({ consumerId, event, response }) =>
          logEgress(consumerId, event, response),
      });
    },
  },

  "byoh-relay": {
    id: "byoh-relay",
    description:
      "BYOH path. Factory dynamic-imports @agent-assistant/harness and routes execution through createAgentRelayExecutionAdapter. Needs Relay broker running and env vars: RELAY_CHANNEL, RELAY_WORKER, RELAY_AUTO_SPAWN, RELAY_CLI, RELAY_MODEL.",
    register(registry) {
      registerSlackSpecialistConsumer(registry, {
        id: "byoh-relay",
        specialistKind: "github",
        predicate: (event) => event.eventType === "app_mention",
        egress: ({ consumerId, event, response }) =>
          logEgress(consumerId, event, response),
        specialistFactory: async ({ event, instruction }) => {
          // createAgentRelayExecutionAdapter is intentionally exposed only
          // on the /agent-relay subpath so workerd bundles of the harness
          // package stay clean. Importing from the main entry silently
          // returns a module without the function.
          const moduleName = "@agent-assistant/harness/agent-relay";
          const mod = (await import(moduleName)) as {
            createAgentRelayExecutionAdapter?: (config: unknown) => {
              execute: (request: unknown) => Promise<unknown>;
            };
          };
          if (!mod.createAgentRelayExecutionAdapter) {
            throw new Error(
              "createAgentRelayExecutionAdapter not exported from @agent-assistant/harness/agent-relay — ensure @agent-assistant/harness >=0.3.8 is installed",
            );
          }

          const adapter = mod.createAgentRelayExecutionAdapter({
            channelId: process.env.RELAY_CHANNEL ?? "specialists",
            workerName: process.env.RELAY_WORKER ?? "specialist-worker",
            spawnWorker: {
              enabled: process.env.RELAY_AUTO_SPAWN === "true",
              cli: process.env.RELAY_CLI ?? "claude",
              name: process.env.RELAY_WORKER,
              model: process.env.RELAY_MODEL,
            },
          });

          return {
            handler: {
              async execute() {
                return adapter.execute({
                  assistantId: "slack-specialist",
                  turnId: `turn-${event.deliveryId ?? Date.now()}`,
                  message: {
                    id: String(event.deliveryId ?? ""),
                    text: instruction,
                    receivedAt: new Date().toISOString(),
                  },
                  instructions: {
                    systemPrompt: "Relay-hosted specialist responding to Slack.",
                  },
                });
              },
            },
          };
        },
      });
    },
  },

  "http-forward": {
    id: "http-forward",
    description:
      "kind:http consumer. POSTs the normalized event to HTTP_FORWARD_URL (required env var). Useful for piping events into webhook.site, ngrok, or a local debug server.",
    register(registry) {
      const url = process.env.HTTP_FORWARD_URL;
      if (!url) {
        throw new Error(
          "http-forward requires HTTP_FORWARD_URL env var (e.g. https://webhook.site/...)",
        );
      }
      registry.register({
        id: "http-forward",
        kind: "http",
        provider: "slack",
        url,
        headers: { "x-cli-forward": "1" },
        timeoutMs: 5_000,
      });
    },
  },

  failer: {
    id: "failer",
    description:
      "Specialist consumer whose factory throws. Exercises the failed[] fanout branch and the [error] log path without needing a broken payload.",
    register(registry) {
      registerSlackSpecialistConsumer(registry, {
        id: "failer",
        specialistKind: "github",
        egress: () => {},
        specialistFactory: () => {
          throw new Error("intentional failure from 'failer' persona");
        },
      });
    },
  },
};

export function describePersona(persona: Persona): string {
  return `  ${persona.id.padEnd(14)} ${persona.description}`;
}
