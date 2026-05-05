import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  buildAgentAssistantA2aCard,
  registerA2aRoutes,
  type A2aSkillDispatcher,
} from "./a2a-runtime.js";

describe("a2a-runtime", () => {
  it("builds a validated reusable agent card", () => {
    const card = buildAgentAssistantA2aCard({
      name: "example-agent",
      description: "Reusable assistant",
      url: "https://example.test/",
      version: "0.1.0",
      capabilities: { streaming: false },
      skills: [
        {
          id: "example.echo",
          name: "Echo",
          description: "Echo an input payload",
          tags: ["test"],
        },
      ],
    });

    expect(card).toMatchObject({
      name: "example-agent",
      url: "https://example.test",
      version: "0.1.0",
      default_input_modes: ["text"],
      default_output_modes: ["text"],
      skills: [{ id: "example.echo" }],
    });
  });

  it("registers public card routes and legacy redirect", async () => {
    const app = new Hono();
    registerA2aRoutes(app, {
      name: "example-agent",
      url: "https://example.test",
      version: "0.1.0",
      skills: [{ id: "example.echo", name: "Echo" }],
      authToken: "secret",
    });

    const cardResponse = await app.request("/.well-known/agent-card.json");
    expect(cardResponse.status).toBe(200);
    expect(cardResponse.headers.get("access-control-allow-origin")).toBe("*");
    await expect(cardResponse.json()).resolves.toMatchObject({
      name: "example-agent",
      skills: [{ id: "example.echo" }],
    });

    const legacyResponse = await app.request("/.well-known/agent.json");
    expect(legacyResponse.status).toBe(308);
    expect(legacyResponse.headers.get("location")).toBe("/.well-known/agent-card.json");
  });

  it("dispatches message/send to the configured skill handler", async () => {
    const dispatchSkill: A2aSkillDispatcher = vi.fn(({ skillId, body }) => ({
      data: {
        skillId,
        echoed: body.value,
      },
    }));
    const app = new Hono();
    registerA2aRoutes(app, {
      name: "example-agent",
      url: "https://example.test",
      version: "0.1.0",
      skills: [{ id: "example.echo", name: "Echo" }],
      authToken: "secret",
      dispatchSkill,
    });

    const response = await app.request("/a2a/rpc", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "message/send",
        params: {
          message: {
            message_id: "msg-1",
            role: "user",
            parts: [
              {
                kind: "data",
                data: {
                  skill: "example.echo",
                  value: "hello",
                },
              },
            ],
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "req-1",
      result: {
        task: {
          id: "msg-1",
          status: { state: "completed" },
          metadata: { skill: "example.echo" },
        },
        message: {
          role: "agent",
          parts: [
            {
              kind: "text",
              text: JSON.stringify({ skillId: "example.echo", echoed: "hello" }),
            },
          ],
        },
      },
    });
    expect(dispatchSkill).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated RPC requests by default", async () => {
    const app = new Hono();
    registerA2aRoutes(app, {
      name: "example-agent",
      url: "https://example.test",
      version: "0.1.0",
      skills: [{ id: "example.echo", name: "Echo" }],
      authToken: "secret",
    });

    const response = await app.request("/a2a/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-1",
        method: "message/send",
        params: {
          message: {
            message_id: "msg-1",
            role: "user",
            parts: [{ kind: "text", text: JSON.stringify({ skill: "example.echo" }) }],
          },
        },
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: -32001,
        message: "Missing Bearer token",
      },
    });
  });
});
