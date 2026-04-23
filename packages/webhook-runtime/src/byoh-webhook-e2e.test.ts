import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionRequest } from "@agent-assistant/harness";

import { personaCatalog } from "../examples/personas.js";
import { startHttpRuntime } from "./http-runtime.js";
import type { FanoutResult } from "./types.js";
import { createWebhookRegistry } from "./webhook-registry.js";

const executeCalls = vi.hoisted(() => [] as ExecutionRequest[]);

vi.mock("@agent-assistant/harness", () => ({
  createAgentRelayExecutionAdapter: vi.fn(() => ({
    async execute(request: ExecutionRequest) {
      executeCalls.push(request);
      return {
        status: "completed",
        output: { text: "mocked specialist response" },
      };
    },
  })),
}));

function registerByohRelay(registry: ReturnType<typeof createWebhookRegistry>): void {
  const persona = personaCatalog["byoh-relay"];
  if (!persona) {
    throw new Error("byoh-relay persona is missing");
  }

  persona.register(registry);
}

function singleExecuteCall(): ExecutionRequest {
  expect(executeCalls).toHaveLength(1);
  const [request] = executeCalls;
  if (!request) {
    throw new Error("Expected one execution request");
  }

  return request;
}

describe("byoh-relay webhook e2e", () => {
  beforeEach(() => {
    executeCalls.length = 0;
  });

  it("routes Slack app_mention events to the BYOH relay execution adapter", async () => {
    const registry = createWebhookRegistry();
    registerByohRelay(registry);
    const runtime = startHttpRuntime({ registry, port: 0 });
    const instruction = "<@U_BOT> inspect the webhook runtime";

    try {
      const response = await fetch(`${runtime.url}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "event_callback",
          event_id: "Ev_BYOH_E2E",
          event_time: 1_700_000_300,
          event: {
            type: "app_mention",
            team_id: "T_BYOH",
            channel: "C_BYOH",
            user: "U_BYOH",
            text: instruction,
            ts: "1700000300.000001",
            event_ts: "1700000300.000001",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as FanoutResult;
      expect(body.succeeded).toContain("byoh-relay");
      expect(body.failed).toEqual([]);

      const captured = singleExecuteCall();
      expect(captured.assistantId).toBe("slack-specialist");
      expect(captured.turnId).toMatch(/^turn-/);
      expect(captured.message.text).toBe(instruction);
      expect(captured.instructions.systemPrompt).toEqual(expect.any(String));
      expect(captured.instructions.systemPrompt.trim()).not.toBe("");
    } finally {
      await runtime.stop();
    }
  });

  it("skips byoh-relay for Slack events that are not app_mention events", async () => {
    const registry = createWebhookRegistry();
    registerByohRelay(registry);
    const runtime = startHttpRuntime({ registry, port: 0 });

    try {
      const response = await fetch(`${runtime.url}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "event_callback",
          event_id: "Ev_BYOH_SKIP",
          event_time: 1_700_000_400,
          event: {
            type: "message",
            team_id: "T_BYOH",
            channel: "C_BYOH",
            user: "U_BYOH",
            text: "ordinary channel message",
            ts: "1700000400.000001",
            event_ts: "1700000400.000001",
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        total: 1,
        succeeded: [],
        failed: [],
        skipped: [{ id: "byoh-relay", reason: "predicate" }],
      });
      expect(executeCalls).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
