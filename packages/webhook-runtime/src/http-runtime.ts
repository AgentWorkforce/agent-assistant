import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";

import { parseSlackEvent } from "./slack-parser.js";
import type {
  FanoutResult,
  NormalizedWebhook,
  RegistryLogger,
  WebhookProvider,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

type FanoutRegistry = {
  fanout(provider: WebhookProvider, event: NormalizedWebhook): Promise<FanoutResult>;
};

export type StartHttpRuntimeOptions = {
  registry: FanoutRegistry;
  port: number;
  logger?: RegistryLogger;
};

export type HttpRuntime = {
  stop(): Promise<void>;
  url: string;
};

const DEFAULT_HOSTNAME = "127.0.0.1";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseJsonRecord(rawBody: string, label: string): JsonRecord {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error(`${label} is empty`);
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be an object`);
  }

  return parsed;
}

function readNangoProvider(envelope: JsonRecord): string | undefined {
  return readString(envelope.from) ?? readString(envelope.provider);
}

function validateNangoSlackEnvelope(rawBody: string): JsonRecord {
  const envelope = parseJsonRecord(rawBody, "Nango webhook payload");
  const provider = readNangoProvider(envelope)?.toLowerCase();

  if (provider !== "slack") {
    throw new Error(`Unsupported Nango provider: ${provider ?? "unknown"}`);
  }

  if (!("payload" in envelope)) {
    throw new Error("Nango Slack webhook payload is missing payload");
  }

  return envelope;
}

function routeUrlHost(address: AddressInfo, fallback: string): string {
  if (!address.address || address.address === "::" || address.address === "0.0.0.0") {
    return fallback;
  }

  return address.address.includes(":") ? `[${address.address}]` : address.address;
}

function resolveServerUrl(
  server: ServerType,
  requestedPort: number,
  fallbackHostname: string,
): string {
  if (requestedPort !== 0) {
    return `http://${fallbackHostname}:${requestedPort}`;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP runtime server address was not available");
  }

  return `http://${routeUrlHost(address, fallbackHostname)}:${address.port}`;
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function fanoutNormalized(
  registry: FanoutRegistry,
  normalized: NormalizedWebhook,
): Promise<FanoutResult> {
  return registry.fanout(normalized.provider, normalized);
}

export function startHttpRuntime({
  registry,
  port,
  logger,
}: StartHttpRuntimeOptions): HttpRuntime {
  const app = new Hono();

  app.post("/webhooks/slack", async (c) => {
    const rawBody = await c.req.text();
    let normalized: NormalizedWebhook;

    try {
      normalized = parseSlackEvent(rawBody);
    } catch (error) {
      const message = errorToMessage(error);
      await logger?.warn?.("Slack webhook rejected", {
        area: "webhook-http-runtime",
        error: message,
      });
      return c.json({ error: message }, 400);
    }

    const result = await fanoutNormalized(registry, normalized);
    return c.json(result, 200);
  });

  app.post("/webhooks/nango", async (c) => {
    const rawBody = await c.req.text();
    let normalized: NormalizedWebhook;

    try {
      const envelope = validateNangoSlackEnvelope(rawBody);
      normalized = parseSlackEvent(envelope);
    } catch (error) {
      const message = errorToMessage(error);
      await logger?.warn?.("Nango webhook rejected", {
        area: "webhook-http-runtime",
        error: message,
      });
      return c.json({ error: message }, 400);
    }

    const result = await fanoutNormalized(registry, normalized);
    return c.json(result, 200);
  });

  const server = serve({
    fetch: app.fetch,
    port,
  });
  const url = resolveServerUrl(server, port, DEFAULT_HOSTNAME);
  let stopped = false;

  return {
    url,
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      await closeServer(server);
    },
  };
}
