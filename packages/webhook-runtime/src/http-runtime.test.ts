import { describe, expect, it, vi } from "vitest";

import { startHttpRuntime } from "./http-runtime.js";
import type { NormalizedWebhook, RegistryLogger } from "./types.js";
import { createWebhookRegistry } from "./webhook-registry.js";

function quietLogger(): Required<RegistryLogger> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("startHttpRuntime", () => {
  it("returns 400 for malformed JSON on Slack and Nango routes", async () => {
    const logger = quietLogger();
    const registry = createWebhookRegistry({ logger });
    const runtime = startHttpRuntime({
      registry,
      port: 0,
      logger,
    });

    try {
      for (const path of ["/webhooks/slack", "/webhooks/nango"]) {
        const response = await fetch(`${runtime.url}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: "{bad}",
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: expect.any(String),
        });
      }
    } finally {
      await runtime.stop();
    }

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("fans out a Slack webhook and returns the fanout result", async () => {
    const logger = quietLogger();
    const registry = createWebhookRegistry({ logger });
    const handled: NormalizedWebhook[] = [];

    registry.register({
      id: "local-slack-consumer",
      kind: "local",
      provider: "slack",
      handler: (event) => {
        handled.push(event);
      },
    });

    const runtime = startHttpRuntime({
      registry,
      port: 0,
      logger,
    });

    try {
      const slackPayload = {
        type: "event_callback",
        event_id: "Ev_HTTP",
        event_time: 1_700_000_100,
        event: {
          type: "app_mention",
          team_id: "T_HTTP",
          channel: "C_HTTP",
          user: "U_HTTP",
          text: "<@U_BOT> run the http runtime test",
          ts: "1700000100.000001",
          event_ts: "1700000100.000001",
        },
      };

      const response = await fetch(`${runtime.url}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(slackPayload),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        total: 1,
        succeeded: ["local-slack-consumer"],
        failed: [],
        skipped: [],
      });

      expect(handled).toHaveLength(1);
      expect(handled[0]).toMatchObject({
        provider: "slack",
        workspaceId: "T_HTTP",
        eventType: "app_mention",
        deliveryId: "Ev_HTTP",
        data: {
          team_id: "T_HTTP",
          channel: "C_HTTP",
          user: "U_HTTP",
          text: "<@U_BOT> run the http runtime test",
        },
      });
    } finally {
      await runtime.stop();
    }
  });

  it("extracts and fans out a Slack event from a Nango envelope", async () => {
    const logger = quietLogger();
    const registry = createWebhookRegistry({ logger });
    const handled: NormalizedWebhook[] = [];

    registry.register({
      id: "nango-slack-consumer",
      kind: "local",
      provider: "slack",
      handler: (event) => {
        handled.push(event);
      },
    });

    const runtime = startHttpRuntime({
      registry,
      port: 0,
      logger,
    });

    try {
      const response = await fetch(`${runtime.url}/webhooks/nango`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "forward",
          from: "slack",
          connectionId: "conn_http",
          payload: {
            type: "event_callback",
            event_id: "Ev_NANGO_HTTP",
            event: {
              type: "message",
              team_id: "T_NANGO_HTTP",
              channel: "C_NANGO_HTTP",
              user: "U_NANGO_HTTP",
              text: "hello through nango",
              ts: "1700000200.000001",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        total: 1,
        succeeded: ["nango-slack-consumer"],
        failed: [],
        skipped: [],
      });

      expect(handled).toHaveLength(1);
      expect(handled[0]).toMatchObject({
        provider: "slack",
        workspaceId: "T_NANGO_HTTP",
        eventType: "message",
        data: {
          team_id: "T_NANGO_HTTP",
          channel: "C_NANGO_HTTP",
          user: "U_NANGO_HTTP",
          text: "hello through nango",
        },
      });
    } finally {
      await runtime.stop();
    }
  });
});
