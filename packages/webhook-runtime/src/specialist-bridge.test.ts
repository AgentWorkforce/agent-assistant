import { describe, expect, it, vi } from "vitest";

import { registerSlackSpecialistConsumer } from "./specialist-bridge.js";
import { createWebhookRegistry } from "./webhook-registry.js";
import type { NormalizedWebhook, RegistryLogger } from "./types.js";

function quietLogger(): Required<RegistryLogger> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createSlackEvent(overrides: Partial<NormalizedWebhook> = {}): NormalizedWebhook {
  return {
    provider: "slack",
    workspaceId: "T_TEST",
    eventType: "app_mention",
    payload: {
      type: "event_callback",
      event: {
        type: "app_mention",
        text: "<@U_BOT> inspect repo",
      },
    },
    data: {
      team_id: "T_TEST",
      channel: "C_TEST",
      user: "U_TEST",
      text: "<@U_BOT> inspect repo",
    },
    ...overrides,
  };
}

describe("registerSlackSpecialistConsumer", () => {
  it("registers a local Slack consumer and runs an injected specialist factory", async () => {
    const registry = createWebhookRegistry({ logger: quietLogger() });
    const event = createSlackEvent();
    const response = {
      status: "complete",
      summary: "looked at github",
    };
    const execute = vi.fn(async () => response);
    const specialistFactory = vi.fn(async () => ({
      handler: {
        execute,
      },
    }));
    const egress = vi.fn();

    registerSlackSpecialistConsumer(registry, {
      id: "github-slack",
      specialistKind: "github",
      specialistFactory,
      egress,
    });

    expect(registry.get("github-slack")).toMatchObject({
      id: "github-slack",
      kind: "local",
      provider: "slack",
    });

    await expect(registry.fanout("slack", event)).resolves.toEqual({
      total: 1,
      succeeded: ["github-slack"],
      failed: [],
      skipped: [],
    });

    expect(specialistFactory).toHaveBeenCalledWith({
      consumerId: "github-slack",
      specialistKind: "github",
      event,
      instruction: "<@U_BOT> inspect repo",
    });
    expect(execute).toHaveBeenCalledWith(
      "<@U_BOT> inspect repo",
      expect.objectContaining({
        source: "webhook-runtime",
        consumerId: "github-slack",
        specialistKind: "github",
        webhookEvent: event,
      }),
    );
    expect(egress).toHaveBeenCalledWith({
      consumerId: "github-slack",
      specialistKind: "github",
      event,
      response,
    });
  });

  it("carries the predicate through to the registered consumer", async () => {
    const registry = createWebhookRegistry({ logger: quietLogger() });
    const predicate = vi.fn(() => false);
    const specialistFactory = vi.fn();
    const egress = vi.fn();

    registerSlackSpecialistConsumer(registry, {
      id: "predicate-slack",
      specialistKind: "linear",
      predicate,
      specialistFactory,
      egress,
    });

    const event = createSlackEvent();
    await expect(registry.fanout("slack", event)).resolves.toEqual({
      total: 1,
      succeeded: [],
      failed: [],
      skipped: [{ id: "predicate-slack", reason: "predicate" }],
    });

    expect(predicate).toHaveBeenCalledWith(event);
    expect(specialistFactory).not.toHaveBeenCalled();
    expect(egress).not.toHaveBeenCalled();
  });
});
