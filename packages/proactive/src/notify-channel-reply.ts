/**
 * Helpers for interpreting freeform user replies to a pending
 * notify-channel confirmation prompt.
 *
 * The pattern posted by the resolver is:
 *   "Was this the right channel? Reply `yes` to confirm, or
 *    `#channel-name` to redirect."
 *
 * A reply is classified as one of:
 *   - confirm: user typed yes / y / confirm
 *   - redirect: user typed `#channel-name` OR Slack auto-rewrote the
 *     mention into its event-text form `<#C123|channel-name>`
 *   - none: anything else (fall through to existing handlers)
 *
 * The redirect payload exposes both `channelId` (when available from a
 * Slack-formatted mention) and `channelName`. Callers should prefer
 * `channelId` — ID lookup is more robust than name lookup — and fall
 * back to resolving by `channelName` when only a literal `#name` was
 * typed.
 */

export const CONFIRM_PROMPT_SUFFIX =
  '\n\n_Was this the right channel? Reply `yes` to confirm, or `#channel-name` to redirect._';

export interface RedirectTarget {
  channelId?: string;
  channelName?: string;
}

export type ConfirmReplyParse =
  | { kind: 'confirm' }
  | ({ kind: 'redirect' } & RedirectTarget)
  | { kind: 'none' };

const SLACK_CHANNEL_MENTION = /^<#([A-Z0-9]+)(?:\|([^>]*))?>$/;
const LITERAL_CHANNEL_NAME = /^[a-z0-9_-]+$/i;

export function normalizeChannelName(channel: string): string {
  return channel.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Parses the channel-redirect form of a confirmation reply.
 *
 * Accepts:
 *   - `#channel-name`                — literal composer input
 *   - `<#C123>` / `<#C123|name>`     — Slack's event-text rewrite
 *
 * Returns `undefined` if neither form matches.
 */
export function parseRedirectChannelName(text: string): RedirectTarget | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const mentionMatch = SLACK_CHANNEL_MENTION.exec(trimmed);
  if (mentionMatch) {
    const [, channelId, rawName] = mentionMatch;
    const channelName = rawName && rawName.length > 0 ? normalizeChannelName(rawName) : undefined;
    return {
      ...(channelId ? { channelId } : {}),
      ...(channelName ? { channelName } : {}),
    };
  }

  if (!trimmed.startsWith('#')) {
    return undefined;
  }

  const candidate = trimmed.slice(1).trim();
  if (!LITERAL_CHANNEL_NAME.test(candidate)) {
    return undefined;
  }

  return { channelName: normalizeChannelName(candidate) };
}

export function parseConfirmReply(text: string): ConfirmReplyParse {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'none' };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'yes' || normalized === 'y' || normalized === 'confirm') {
    return { kind: 'confirm' };
  }

  const redirect = parseRedirectChannelName(trimmed);
  if (redirect && (redirect.channelId || redirect.channelName)) {
    return { kind: 'redirect', ...redirect };
  }

  return { kind: 'none' };
}
