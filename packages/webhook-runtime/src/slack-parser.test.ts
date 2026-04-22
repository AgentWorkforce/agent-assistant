import { describe, expect, it } from "vitest";

import { parseSlackEvent } from "./slack-parser.js";

describe("parseSlackEvent", () => {
  it("normalizes a direct Slack event callback payload", () => {
    const slackPayload = {
      type: "event_callback",
      event_id: "Ev_DIRECT",
      event_time: 1_700_000_000,
      authorizations: [{ team_id: "T_AUTH" }],
      event: {
        type: "app_mention",
        team_id: "T_EVENT",
        channel: "C_DIRECT",
        user: "U_DIRECT",
        text: "<@U_BOT> check github",
        ts: "1700000000.000001",
        event_ts: "1700000000.000001",
      },
    };

    const normalized = parseSlackEvent(slackPayload);

    expect(normalized).toMatchObject({
      provider: "slack",
      workspaceId: "T_EVENT",
      eventType: "app_mention",
      objectType: "slack_event",
      objectId: "1700000000.000001",
      deliveryId: "Ev_DIRECT",
      timestamp: "1700000000.000001",
      path: "slack.event",
      data: {
        team_id: "T_EVENT",
        channel: "C_DIRECT",
        user: "U_DIRECT",
        text: "<@U_BOT> check github",
      },
    });
    expect(normalized.payload).toBe(slackPayload);
  });

  it("uses authorizations[0].team_id when the event omits team_id", () => {
    const normalized = parseSlackEvent({
      type: "event_callback",
      authorizations: [{ team_id: "T_AUTH_FALLBACK" }],
      event: {
        type: "app_mention",
        channel: "C_AUTH",
        user: "U_AUTH",
        text: "fallback team",
        ts: "1700000000.000002",
      },
    });

    expect(normalized.workspaceId).toBe("T_AUTH_FALLBACK");
    expect(normalized.data).toMatchObject({
      team_id: "T_AUTH_FALLBACK",
      channel: "C_AUTH",
      user: "U_AUTH",
      text: "fallback team",
    });
  });

  it("normalizes a Nango Slack forward envelope while preserving the Slack payload", () => {
    const slackPayload = {
      type: "event_callback",
      event_id: "Ev_NANGO",
      authorizations: [{ team_id: "T_NANGO" }],
      event: {
        type: "app_mention",
        channel: "C_NANGO",
        user: "U_NANGO",
        text: "<@U_BOT> from nango",
        ts: "1700000000.000003",
      },
    };
    const nangoEnvelope = {
      type: "forward",
      from: "slack",
      connectionId: "conn_slack_123",
      providerConfigKey: "slack-sage",
      payload: slackPayload,
    };

    const normalized = parseSlackEvent(nangoEnvelope);

    expect(normalized).toMatchObject({
      provider: "slack",
      connectionId: "conn_slack_123",
      workspaceId: "T_NANGO",
      eventType: "app_mention",
      path: "nango.forward",
      data: {
        team_id: "T_NANGO",
        channel: "C_NANGO",
        user: "U_NANGO",
        text: "<@U_BOT> from nango",
        nango: {
          type: "forward",
          from: "slack",
          providerConfigKey: "slack-sage",
          connectionId: "conn_slack_123",
        },
      },
    });
    expect(normalized.payload).toBe(slackPayload);
  });

  it("accepts a JSON string body", () => {
    const normalized = parseSlackEvent(
      JSON.stringify({
        type: "event_callback",
        event: {
          type: "message",
          team_id: "T_STRING",
          channel: "C_STRING",
          user: "U_STRING",
          text: "hello from json",
        },
      }),
    );

    expect(normalized).toMatchObject({
      provider: "slack",
      workspaceId: "T_STRING",
      eventType: "message",
      data: {
        text: "hello from json",
      },
    });
  });
});
