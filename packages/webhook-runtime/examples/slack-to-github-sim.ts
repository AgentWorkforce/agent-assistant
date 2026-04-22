import {
  createWebhookRegistry,
  registerSlackSpecialistConsumer,
  startHttpRuntime,
} from "../src/index.js";
import type { NormalizedWebhook, RegistryLogger } from "../src/index.js";

const consumerId = "github-sim";

const slackAppMentionFixture = {
  token: "sim-token",
  team_id: "T_SIM",
  api_app_id: "A_SIM",
  type: "event_callback",
  event_id: "Ev_SIM_APP_MENTION",
  event_time: 1_713_333_333,
  event: {
    type: "app_mention",
    user: "U_SIM_USER",
    text: "<@U_SIM_BOT> summarize the open github issues",
    channel: "C_SIM_CHANNEL",
    team: "T_SIM",
    event_ts: "1713333333.000100",
  },
  authorizations: [
    {
      enterprise_id: null,
      team_id: "T_SIM",
      user_id: "U_SIM_BOT",
      is_bot: true,
      is_enterprise_install: false,
    },
  ],
  event_context: "4-eyJldCI6ImFwcF9tZW50aW9uIn0",
  is_ext_shared_channel: false,
};

const quietLogger: RegistryLogger = {
  info() {},
  warn(message, context) {
    console.warn("[runtime warning]", message, context ?? {});
  },
  error(message, context) {
    console.error("[runtime error]", message, context ?? {});
  },
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventTeamId(event: NormalizedWebhook): string {
  return (
    readString(event.data?.team_id) ??
    readString(event.workspaceId) ??
    "unknown-team"
  );
}

function eventChannel(event: NormalizedWebhook): string {
  return readString(event.data?.channel) ?? "unknown-channel";
}

function eventText(event: NormalizedWebhook): string {
  return readString(event.data?.text) ?? "";
}

function responseToText(response: unknown): string {
  return typeof response === "string"
    ? response
    : JSON.stringify(response) ?? String(response);
}

async function main(): Promise<void> {
  const logLines: string[] = [];
  const registry = createWebhookRegistry({ logger: quietLogger });

  registerSlackSpecialistConsumer(registry, {
    id: consumerId,
    specialistKind: "github",
    predicate: (event) => event.eventType === "app_mention",
    egress({ consumerId: egressConsumerId, event, response }) {
      logLines.push(
        `[consumer=${egressConsumerId} team_id=${eventTeamId(event)}] ${responseToText(
          response,
        )}`,
      );
    },
    specialistFactory({ event }) {
      return {
        handler: {
          async execute() {
            return `[github-specialist-sim] would look up ${eventChannel(
              event,
            )} for ${eventText(event)}`;
          },
        },
      };
    },
  });

  const runtime = startHttpRuntime({
    registry,
    port: 0,
    logger: quietLogger,
  });

  try {
    const response = await fetch(`${runtime.url}/webhooks/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(slackAppMentionFixture),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`Slack webhook POST failed: ${JSON.stringify(result)}`);
    }

    console.log("--- Fanout result ---");
    console.log(JSON.stringify(result, null, 2));
    console.log("--- Log lines ---");
    console.log(logLines.join("\n"));
  } finally {
    await runtime.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
