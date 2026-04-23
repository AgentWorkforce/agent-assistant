import { beforeEach, describe, expect, it, vi } from "vitest";

import { personaCatalog } from "../examples/personas.js";
import { startHttpRuntime } from "./http-runtime.js";
import { registerSlackSpecialistConsumer } from "./specialist-bridge.js";
import type { SlackSpecialistEgressInput } from "./specialist-bridge.js";
import type { FanoutResult, NormalizedWebhook } from "./types.js";
import { createWebhookRegistry } from "./webhook-registry.js";

type EmptyVfsShape = {
  list(path: string, options?: { depth?: number; limit?: number }): Promise<readonly []>;
  search(query: string, options?: { provider?: string; limit?: number }): Promise<readonly []>;
};

const capturedVfs = vi.hoisted(() => [] as EmptyVfsShape[]);
const executeCalls = vi.hoisted(
  () => [] as Array<{ instruction: string; context: unknown }>,
);
const egressCalls = vi.hoisted(() => [] as SlackSpecialistEgressInput[]);

vi.mock("@agent-assistant/specialists", () => ({
  createGitHubLibrarian: vi.fn(({ vfs }: { vfs: EmptyVfsShape }) => {
    capturedVfs.push(vfs);
    return {
      handler: {
        execute: vi.fn(async (instruction: string, context: unknown) => {
          executeCalls.push({ instruction, context });
          return "mocked github-real response";
        }),
      },
    };
  }),
  createLinearLibrarian: vi.fn(),
}));

function registerGithubReal(registry: ReturnType<typeof createWebhookRegistry>): void {
  const persona = personaCatalog["github-real"];
  if (!persona) {
    throw new Error("github-real persona is missing");
  }

  registerSlackSpecialistConsumer(registry, {
    id: persona.id,
    specialistKind: "github",
    predicate: (event) => event.eventType === "app_mention",
    egress: (input) => {
      egressCalls.push(input);
    },
  });
}

describe("github-real persona webhook e2e", () => {
  beforeEach(() => {
    capturedVfs.length = 0;
    executeCalls.length = 0;
    egressCalls.length = 0;
  });

  it("routes Slack app_mention events to the default GitHub specialist factory", async () => {
    const registry = createWebhookRegistry();
    registerGithubReal(registry);
    const runtime = startHttpRuntime({ registry, port: 0 });
    const instruction = "<@U_BOT> find open PRs in repo acme/widgets";

    try {
      const response = await fetch(`${runtime.url}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "event_callback",
          event_id: "Ev_GH_REAL_E2E",
          event_time: 1_700_000_500,
          event: {
            type: "app_mention",
            team_id: "T_GH",
            channel: "C_GH",
            user: "U_GH",
            text: instruction,
            ts: "1700000500.000001",
            event_ts: "1700000500.000001",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as FanoutResult;
      expect(body.succeeded).toContain("github-real");
      expect(body.failed).toEqual([]);

      expect(capturedVfs).toHaveLength(1);
      const [vfs] = capturedVfs;
      if (!vfs) {
        throw new Error("Expected GitHub librarian VFS to be captured");
      }
      expect(typeof vfs.list).toBe("function");
      expect(typeof vfs.search).toBe("function");
      await expect(vfs.list("/")).resolves.toEqual([]);
      await expect(vfs.search("x")).resolves.toEqual([]);

      expect(executeCalls).toHaveLength(1);
      const [executeCall] = executeCalls;
      if (!executeCall) {
        throw new Error("Expected one GitHub specialist execution");
      }
      expect(executeCall.instruction).toBe(instruction);
      expect(executeCall.context).toMatchObject({
        source: "webhook-runtime",
        consumerId: "github-real",
        specialistKind: "github",
      });
      const context = executeCall.context as {
        webhookEvent?: NormalizedWebhook;
      };
      expect(context.webhookEvent?.eventType).toBe("app_mention");
      expect(context.webhookEvent).toMatchObject({
        eventType: "app_mention",
      });

      expect(egressCalls).toHaveLength(1);
      const [egressCall] = egressCalls;
      if (!egressCall) {
        throw new Error("Expected one GitHub specialist egress call");
      }
      expect(egressCall.consumerId).toBe("github-real");
      expect(egressCall.specialistKind).toBe("github");
      expect(egressCall.response).toBe("mocked github-real response");
      expect(egressCall.event).toEqual(context.webhookEvent);
    } finally {
      await runtime.stop();
    }
  });

  it("skips github-real for Slack events that are not app_mention events", async () => {
    const registry = createWebhookRegistry();
    registerGithubReal(registry);
    const runtime = startHttpRuntime({ registry, port: 0 });

    try {
      const response = await fetch(`${runtime.url}/webhooks/slack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "event_callback",
          event_id: "Ev_GH_REAL_SKIP",
          event_time: 1_700_000_600,
          event: {
            type: "message",
            team_id: "T_GH",
            channel: "C_GH",
            user: "U_GH",
            text: "ordinary channel message",
            ts: "1700000600.000001",
            event_ts: "1700000600.000001",
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        total: 1,
        succeeded: [],
        failed: [],
        skipped: [{ id: "github-real", reason: "predicate" }],
      });
      expect(capturedVfs).toHaveLength(0);
      expect(executeCalls).toHaveLength(0);
      expect(egressCalls).toHaveLength(0);
    } finally {
      await runtime.stop();
    }
  });
});
