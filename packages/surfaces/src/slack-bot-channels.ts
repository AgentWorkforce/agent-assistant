export interface BotChannel {
  id: string;
  name: string;
  topic?: string;
  purpose?: string;
  numMembers?: number;
}

interface SlackChannel {
  id?: unknown;
  name?: unknown;
  topic?: { value?: unknown };
  purpose?: { value?: unknown };
  num_members?: unknown;
}

interface SlackUsersConversationsResponse {
  ok?: unknown;
  error?: unknown;
  channels?: unknown;
  response_metadata?: {
    next_cursor?: unknown;
  };
}

const USERS_CONVERSATIONS_URL = 'https://slack.com/api/users.conversations';
const MAX_PAGES = 3;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapChannel(channel: unknown): BotChannel | null {
  if (!channel || typeof channel !== 'object') {
    return null;
  }

  const slackChannel = channel as SlackChannel;
  const topic = readString(slackChannel.topic?.value);
  const purpose = readString(slackChannel.purpose?.value);
  const id = readString(slackChannel.id);
  const name = readString(slackChannel.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    ...(topic ? { topic } : {}),
    ...(purpose ? { purpose } : {}),
    ...(Number.isFinite(slackChannel.num_members)
      ? { numMembers: slackChannel.num_members as number }
      : {}),
  };
}

/**
 * List public and private Slack channels the given bot user is a member of.
 * Follows `next_cursor` pagination up to 3 pages. Throws on `ok: false`.
 */
export async function listBotChannels(
  token: string,
  botUserId: string,
): Promise<BotChannel[]> {
  const channels: BotChannel[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = new URLSearchParams({
      user: botUserId,
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) {
      body.set('cursor', cursor);
    }

    const response = await fetch(USERS_CONVERSATIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });
    const payload = (await response.json()) as SlackUsersConversationsResponse;

    if (payload.ok === false) {
      throw new Error(
        `Slack users.conversations failed: ${readString(payload.error) ?? 'unknown_error'}`,
      );
    }

    if (Array.isArray(payload.channels)) {
      for (const channel of payload.channels) {
        const mapped = mapChannel(channel);
        if (mapped) {
          channels.push(mapped);
        }
      }
    }

    cursor = readString(payload.response_metadata?.next_cursor);
    if (!cursor) {
      break;
    }
  }

  return channels;
}
