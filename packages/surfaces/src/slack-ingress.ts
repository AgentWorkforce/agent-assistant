function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export type SlackIngressKind = 'mention' | 'direct_message' | 'thread_reply' | 'channel_message' | 'ignore';

export interface SlackIngressClassification {
  kind: SlackIngressKind;
  channel?: string;
  userId?: string;
  teamId?: string;
  threadTs?: string;
  ts?: string;
  text?: string;
}

export function classifySlackIngressEvent(payload: unknown): SlackIngressClassification {
  if (!isRecord(payload) || payload.type !== 'event_callback' || !isRecord(payload.event)) {
    return { kind: 'ignore' };
  }

  const event = payload.event;
  const eventType = asString(event.type);
  const subtype = asString(event.subtype);
  const channelType = asString(event.channel_type);
  const ts = asString(event.ts);
  const threadTs = asString(event.thread_ts);
  const base = {
    channel: asString(event.channel),
    userId: asString(event.user),
    teamId: asString(payload.team_id) ?? asString(event.team),
    threadTs,
    ts,
    text: asString(event.text),
  };

  if (subtype === 'bot_message' || subtype === 'message_changed' || subtype === 'message_deleted') {
    return { kind: 'ignore', ...base };
  }

  if ((typeof event.bot_id === 'string' && event.bot_id.length > 0) || isRecord(event.bot_profile)) {
    return { kind: 'ignore', ...base };
  }

  if (eventType === 'app_mention') {
    return { kind: 'mention', ...base };
  }

  if (eventType === 'message' && channelType === 'im' && !subtype) {
    return { kind: 'direct_message', ...base };
  }

  if (eventType === 'message' && threadTs && !subtype) {
    return { kind: 'thread_reply', ...base };
  }

  if (eventType === 'message' && !threadTs && !subtype) {
    return { kind: 'channel_message', ...base };
  }

  return { kind: 'ignore', ...base };
}
