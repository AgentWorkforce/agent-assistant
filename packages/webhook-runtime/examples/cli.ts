import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { createWebhookRegistry, startHttpRuntime } from "../src/index.js";
import type { RegistryLogger } from "../src/index.js";
import { personaCatalog, describePersona } from "./personas.js";

const port = Number(process.env.PORT ?? 3777);

const logger: RegistryLogger = {
  info(message, context) {
    console.log("[info]", message, context ?? "");
  },
  warn(message, context) {
    console.warn("[warn]", message, context ?? "");
  },
  error(message, context) {
    console.error("[error]", message, context ?? "");
  },
};

const registry = createWebhookRegistry({ logger });
const activePersonas = new Set<string>();

function usePersona(id: string): void {
  const persona = personaCatalog[id];
  if (!persona) {
    throw new Error(`unknown persona: ${id}. run 'personas' for the catalog.`);
  }
  persona.register(registry);
  activePersonas.add(id);
  console.log(`[cli] registered persona '${id}'`);
}

function dropPersona(id: string): void {
  if (!registry.unregister(id)) {
    console.log(`[cli] no consumer registered with id '${id}'`);
    return;
  }
  activePersonas.delete(id);
  console.log(`[cli] unregistered consumer '${id}'`);
}

const defaultPersonas = ["echo", "github-stub"];
for (const id of defaultPersonas) {
  usePersona(id);
}

const runtime = startHttpRuntime({ registry, port, logger });
console.log(`\nwebhook-runtime listening at ${runtime.url}`);
console.log(
  `Active personas: ${Array.from(activePersonas).join(", ")}. Type 'help' for commands.\n`,
);

const rl = createInterface({ input, output });

function slackMentionFixture(text: string): unknown {
  const now = Date.now();
  return {
    token: "cli-token",
    team_id: "T_CLI",
    api_app_id: "A_CLI",
    type: "event_callback",
    event_id: `Ev_${now}`,
    event_time: Math.floor(now / 1000),
    event: {
      type: "app_mention",
      user: "U_CLI_USER",
      text,
      channel: "C_CLI",
      team: "T_CLI",
      event_ts: `${now / 1000}`,
    },
  };
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${runtime.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // not json
  }
  console.log(`[${response.status}] ${pretty}`);
}

const help = `
commands:
  help                      show this help
  url                       print webhook URL
  personas                  list the persona catalog
  use <id>                  register a persona
  drop <id>                 unregister a consumer
  consumers                 list currently active personas
  mention <text>            POST an app_mention fixture to /webhooks/slack
  slack <json>              POST raw Slack JSON body
  nango <json>              wrap JSON as {from:"slack", payload} and POST to /webhooks/nango
  file <path>               POST JSON loaded from a file to /webhooks/slack
  quit | exit               shut down
`;

async function shutdown(code = 0): Promise<never> {
  rl.close();
  await runtime.stop();
  process.exit(code);
}

process.on("SIGINT", () => {
  console.log("\nshutting down...");
  void shutdown(0);
});

function printPersonas(): void {
  console.log("\npersona catalog:");
  for (const persona of Object.values(personaCatalog)) {
    console.log(describePersona(persona));
  }
  console.log();
}

function printConsumers(): void {
  if (activePersonas.size === 0) {
    console.log("no active personas");
    return;
  }
  for (const id of activePersonas) {
    console.log(`  ${id}`);
  }
}

async function handle(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  const spaceIndex = trimmed.indexOf(" ");
  const cmd = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const arg = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

  switch (cmd) {
    case "help":
      console.log(help);
      return;
    case "url":
      console.log(runtime.url);
      return;
    case "personas":
      printPersonas();
      return;
    case "use":
      if (!arg) {
        console.log("usage: use <persona-id>");
        return;
      }
      usePersona(arg);
      return;
    case "drop":
      if (!arg) {
        console.log("usage: drop <consumer-id>");
        return;
      }
      dropPersona(arg);
      return;
    case "consumers":
      printConsumers();
      return;
    case "mention":
      await post(
        "/webhooks/slack",
        slackMentionFixture(arg || "<@U_CLI_BOT> ping"),
      );
      return;
    case "slack":
      await post("/webhooks/slack", JSON.parse(arg));
      return;
    case "nango":
      await post("/webhooks/nango", {
        from: "slack",
        payload: JSON.parse(arg),
      });
      return;
    case "file": {
      const raw = await readFile(arg, "utf8");
      await post("/webhooks/slack", JSON.parse(raw));
      return;
    }
    case "quit":
    case "exit":
      await shutdown(0);
      return;
    default:
      console.log(`unknown command: ${cmd}. type 'help'`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    const line = await rl.question("webhook> ");
    try {
      await handle(line);
    } catch (error) {
      console.error(
        "error:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

loop().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  void shutdown(1);
});
