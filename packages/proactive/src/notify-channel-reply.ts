/**
 * Helpers for interpreting freeform user replies to a pending
 * notify-channel confirmation prompt.
 *
 * The pattern posted by the resolver is:
 *   "Was this the right channel? Reply `yes` to confirm, or
 *    `#channel-name` to redirect."
 *
 * A reply is classified as one of:
 *   - {@link ConfirmReplyKind.Confirm}: user typed yes / y / confirm
 *   - {@link ConfirmReplyKind.Redirect}: user typed `#channel-name`
 *   - {@link ConfirmReplyKind.None}: anything else (fall through)
 */

export const CONFIRM_PROMPT_SUFFIX =
  '\n\n_Was this the right channel? Reply `yes` to confirm, or `#channel-name` to redirect._';

export type ConfirmReplyParse =
  | { kind: 'confirm' }
  | { kind: 'redirect'; channelName: string }
  | { kind: 'none' };

export function normalizeChannelName(channel: string): string {
  return channel.trim().replace(/^#/, '').toLowerCase();
}

export function parseRedirectChannelName(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('#')) {
    return undefined;
  }

  const channelName = trimmed.slice(1).trim();
  if (!/^[a-z0-9_-]+$/i.test(channelName)) {
    return undefined;
  }

  return normalizeChannelName(channelName);
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
  if (redirect) {
    return { kind: 'redirect', channelName: redirect };
  }

  return { kind: 'none' };
}
