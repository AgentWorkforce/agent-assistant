import type { NormalizedWebhook } from "./types.js";

type JsonRecord = Record<string, unknown>;

type SlackExtraction = {
  slackPayload: JsonRecord;
  nangoEnvelope?: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseRawBody(rawBody: unknown): unknown {
  if (typeof rawBody !== "string") {
    return rawBody;
  }

  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error("Slack webhook payload is empty");
  }

  return JSON.parse(trimmed) as unknown;
}

function readFirstAuthorizationTeamId(payload: JsonRecord): string | undefined {
  const authorizations = payload.authorizations;
  if (!Array.isArray(authorizations)) {
    return undefined;
  }

  const first = authorizations[0];
  return isRecord(first) ? readString(first.team_id) : undefined;
}

function isSlackEventPayload(value: unknown): value is JsonRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (isRecord(value.event)) {
    return true;
  }

  return readString(value.type) !== undefined;
}

function readNangoProvider(envelope: JsonRecord): string | undefined {
  return readString(envelope.from) ?? readString(envelope.provider);
}

function extractSlackPayload(value: unknown): SlackExtraction {
  if (!isRecord(value)) {
    throw new Error("Slack webhook payload must be an object");
  }

  const nestedPayload = value.payload;
  const provider = readNangoProvider(value)?.toLowerCase();
  if (isRecord(nestedPayload) && (provider === "slack" || isSlackEventPayload(nestedPayload))) {
    return {
      slackPayload: nestedPayload,
      nangoEnvelope: value,
    };
  }

  return { slackPayload: value };
}

function readSlackEvent(slackPayload: JsonRecord): JsonRecord {
  if (isRecord(slackPayload.event)) {
    return slackPayload.event;
  }

  return slackPayload;
}

function buildPayloadData(input: {
  teamId?: string;
  channel?: string;
  user?: string;
  text?: string;
  event: JsonRecord;
  nangoEnvelope?: JsonRecord;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    event: input.event,
  };

  if (input.teamId) data.team_id = input.teamId;
  if (input.channel) data.channel = input.channel;
  if (input.user) data.user = input.user;
  if (input.text) data.text = input.text;

  if (input.nangoEnvelope) {
    data.nango = {
      type: readString(input.nangoEnvelope.type),
      from: readNangoProvider(input.nangoEnvelope),
      providerConfigKey: readString(input.nangoEnvelope.providerConfigKey),
      connectionId:
        readString(input.nangoEnvelope.connectionId) ??
        readString(input.nangoEnvelope.connection_id),
    };
  }

  return data;
}

function readTimestamp(slackPayload: JsonRecord, event: JsonRecord): string | undefined {
  const eventTime = slackPayload.event_time;
  return (
    readString(event.event_ts) ??
    readString(event.ts) ??
    (typeof eventTime === "number" ? String(eventTime) : readString(eventTime))
  );
}

/**
 * Normalize a Slack Events API payload. Accepts either a direct Slack event
 * callback body or a Nango forward envelope whose `payload` is the Slack body.
 */
export function parseSlackEvent(rawBody: unknown): NormalizedWebhook {
  const parsed = parseRawBody(rawBody);
  const { slackPayload, nangoEnvelope } = extractSlackPayload(parsed);
  const event = readSlackEvent(slackPayload);
  const eventType = readString(event.type);
  if (!eventType) {
    throw new Error("Slack event payload is missing event.type");
  }

  const teamId =
    readString(event.team_id) ??
    readFirstAuthorizationTeamId(slackPayload) ??
    readString(slackPayload.team_id) ??
    readString(event.team);
  const channel = readString(event.channel);
  const user = readString(event.user);
  const text = readString(event.text);
  const timestamp = readTimestamp(slackPayload, event);
  const connectionId = nangoEnvelope
    ? readString(nangoEnvelope.connectionId) ?? readString(nangoEnvelope.connection_id)
    : undefined;
  const deliveryId =
    readString(slackPayload.event_id) ??
    readString(event.client_msg_id) ??
    readString(event.event_ts) ??
    readString(event.ts);

  return {
    provider: "slack",
    connectionId,
    workspaceId: teamId,
    eventType,
    objectType: "slack_event",
    objectId: readString(event.client_msg_id) ?? readString(event.event_ts) ?? readString(event.ts),
    payload: slackPayload,
    path: nangoEnvelope ? "nango.forward" : "slack.event",
    data: buildPayloadData({
      teamId,
      channel,
      user,
      text,
      event,
      nangoEnvelope,
    }),
    deliveryId,
    timestamp,
  };
}
