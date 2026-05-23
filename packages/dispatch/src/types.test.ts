import { describe, expect, it } from "vitest";

import type { DispatchEnvelope, DispatchResponse } from "./types.js";

describe("dispatch envelopes", () => {
  it("constructs a cron.tick envelope", () => {
    const envelope: DispatchEnvelope<{ cron: string }> = {
      type: "cron.tick",
      personaId: "morning-briefing",
      workspaceId: "workspace-1",
      deploymentId: "deployment-1",
      occurredAt: "2026-05-23T08:00:00.000Z",
      envelope: {
        id: "evt-cron-1",
        name: "morning cron",
        payload: { cron: "0 8 * * 1-5" },
      },
    };

    expect(envelope.type).toBe("cron.tick");
    expect(envelope.envelope.payload.cron).toBe("0 8 * * 1-5");
  });

  it("constructs an integration.github.pull_request.opened envelope", () => {
    const envelope: DispatchEnvelope<{ number: number; repository: string }> = {
      type: "integration.github.pull_request.opened",
      personaId: "pr-matcher",
      workspaceId: "workspace-1",
      deploymentId: "deployment-1",
      occurredAt: "2026-05-23T09:00:00.000Z",
      envelope: {
        id: "evt-github-1",
        payload: {
          number: 42,
          repository: "AgentWorkforce/sage",
        },
      },
      integrations: {
        github: {
          provider: "github",
          connectionId: "conn-github-1",
          scopes: ["pull_request:read"],
        },
      },
    };

    expect(envelope.integrations?.github?.scopes).toEqual(["pull_request:read"]);
    expect(envelope.envelope.payload.number).toBe(42);
  });

  it("constructs an inbox.slack.app_mention envelope", () => {
    const envelope: DispatchEnvelope<{ channel: string; text: string; threadTs?: string }> = {
      type: "inbox.slack.app_mention",
      personaId: "follow-up-sweep",
      workspaceId: "workspace-1",
      deploymentId: "deployment-1",
      occurredAt: "2026-05-23T10:00:00.000Z",
      envelope: {
        id: "evt-slack-1",
        payload: {
          channel: "C123",
          text: "@assistant check stale threads",
          threadTs: "1716468000.000000",
        },
      },
      callbackEndpoint: "https://dispatch.example/callback",
    };

    expect(envelope.type).toBe("inbox.slack.app_mention");
    expect(envelope.envelope.payload.channel).toBe("C123");
  });
});

describe("dispatch responses", () => {
  it("constructs a done response", () => {
    const response: DispatchResponse = {
      kind: "done",
      delivery: [
        {
          kind: "slack.message",
          target: "C123",
          text: "Briefing ready",
        },
      ],
      log: [
        {
          level: "info",
          message: "Delivered briefing",
        },
      ],
    };

    expect(response.kind).toBe("done");
    expect(response.delivery).toHaveLength(1);
  });

  it("constructs a borrow-sandbox response", () => {
    const response: DispatchResponse = {
      kind: "borrow-sandbox",
      reason: "Needs repository inspection",
      task: {
        command: "npm test",
        env: {
          CI: "true",
        },
      },
      afterTask: {
        kind: "callback",
        url: "https://dispatch.example/after-task",
      },
    };

    expect(response.kind).toBe("borrow-sandbox");
    expect(response.task.command).toBe("npm test");
  });

  it("constructs an async response", () => {
    const response: DispatchResponse = {
      kind: "async",
      estimatedDurationSeconds: 120,
      callback: "https://dispatch.example/callback",
    };

    expect(response.kind).toBe("async");
    expect(response.estimatedDurationSeconds).toBe(120);
  });

  it("constructs an error response", () => {
    const response: DispatchResponse = {
      kind: "error",
      retryable: true,
      code: "RATE_LIMITED",
      message: "GitHub API rate limit exceeded",
    };

    expect(response.kind).toBe("error");
    expect(response.retryable).toBe(true);
  });
});

// @ts-expect-error borrow-sandbox responses require a SandboxTask in the task field.
const missingSandboxTask: DispatchResponse = {
  kind: "borrow-sandbox",
  reason: "Needs repository inspection",
};

void missingSandboxTask;
