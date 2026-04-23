import type { ProactiveSignal } from '@agent-assistant/proactive';

type SlackPresenceSignal = Pick<ProactiveSignal, 'kind' | 'workspaceId' | 'subjectId' | 'payload'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function classifySlackPresenceSignal(
  payload: unknown,
  workspaceId: string,
): SlackPresenceSignal | null {
  if (!isRecord(payload) || payload.type !== 'event_callback' || !isRecord(payload.event)) {
    return null;
  }

  const event = payload.event;
  const eventType = asString(event.type);

  if (eventType === 'presence_change') {
    const subjectId = asString(event.user);
    const presence = asString(event.presence);

    if (!subjectId || presence === undefined) {
      return null;
    }

    return {
      kind: 'slack.presence',
      workspaceId,
      subjectId,
      payload: { presence },
    };
  }

  if (eventType === 'user_status_changed') {
    if (!isRecord(event.user)) {
      return null;
    }

    const subjectId = asString(event.user.id);
    const profile = event.user.profile;

    if (!subjectId || !isRecord(profile)) {
      return null;
    }

    const statusText = asString(profile.status_text);
    const statusEmoji = asString(profile.status_emoji);

    if (statusText === undefined || statusEmoji === undefined) {
      return null;
    }

    return {
      kind: 'slack.status',
      workspaceId,
      subjectId,
      payload: {
        status_text: statusText,
        status_emoji: statusEmoji,
      },
    };
  }

  return null;
}
