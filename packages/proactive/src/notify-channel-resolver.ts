/**
 * Resolves the target Slack channel for a proactive message with a
 * precedence chain:
 *
 *   1. bodyOverride (caller-supplied)
 *   2. confirmed pref in the pref store
 *   3. unconfirmed pref in the pref store (with silent-fallback auto-confirm
 *      after {@link AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS} posts)
 *   4. discovery: list the channels the bot is a member of and pick one
 *      via {@link ChatFn}
 *
 * Dependencies are injected so this module stays provider-agnostic: the
 * pref store, the LLM, and the channel lister are all supplied by the
 * caller.
 */

import type { BotChannel } from '@agent-assistant/surfaces';

import { pickChannel, type ChatFn, type ProactivePayload } from './channel-picker.js';
import {
  getNotifyChannelPref,
  incrementUnconfirmedPosts,
  setNotifyChannelPref,
  type PrefStore,
} from './notify-channel-prefs.js';

export const AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS = 3;

export interface ResolvedNotifyChannel {
  channel: string;
  shouldAppendConfirmPrompt: boolean;
  source: 'body' | 'pref-confirmed' | 'pref-unconfirmed' | 'discovery';
}

export type ListBotChannelsFn = () => Promise<BotChannel[]>;

export interface ResolveNotifyChannelInput {
  store: PrefStore;
  chat: ChatFn;
  listChannels: ListBotChannelsFn;
  workspaceId: string;
  payload: ProactivePayload;
  bodyOverride?: string | null;
}

function readNonEmptyString(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export async function resolveNotifyChannel(
  input: ResolveNotifyChannelInput,
): Promise<ResolvedNotifyChannel | null> {
  const { store, chat, listChannels, workspaceId, payload, bodyOverride } = input;

  const override = readNonEmptyString(bodyOverride);
  if (override) {
    return {
      channel: override,
      shouldAppendConfirmPrompt: false,
      source: 'body',
    };
  }

  const resolvedWorkspaceId = readNonEmptyString(workspaceId);
  if (!resolvedWorkspaceId) {
    return null;
  }

  const pref = await getNotifyChannelPref(store, resolvedWorkspaceId);
  const prefChannel = readNonEmptyString(pref?.channel);
  if (pref && prefChannel) {
    if (pref.confirmed) {
      return {
        channel: prefChannel,
        shouldAppendConfirmPrompt: false,
        source: 'pref-confirmed',
      };
    }

    if (pref.unconfirmedPosts < AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS) {
      const unconfirmedPosts = await incrementUnconfirmedPosts(store, resolvedWorkspaceId);
      if (unconfirmedPosts >= AUTO_CONFIRM_AFTER_UNCONFIRMED_POSTS) {
        await setNotifyChannelPref(store, resolvedWorkspaceId, prefChannel, true);
      }

      return {
        channel: prefChannel,
        shouldAppendConfirmPrompt: true,
        source: 'pref-unconfirmed',
      };
    }

    await setNotifyChannelPref(store, resolvedWorkspaceId, prefChannel, true);
    return {
      channel: prefChannel,
      shouldAppendConfirmPrompt: false,
      source: 'pref-confirmed',
    };
  }

  let channels: BotChannel[];
  try {
    channels = await listChannels();
  } catch {
    return null;
  }
  if (channels.length === 0) {
    return null;
  }

  const picked = await pickChannel(chat, channels, payload);
  if (!picked) {
    return null;
  }

  await setNotifyChannelPref(store, resolvedWorkspaceId, picked.channelId, false);
  await incrementUnconfirmedPosts(store, resolvedWorkspaceId);

  return {
    channel: picked.channelId,
    shouldAppendConfirmPrompt: true,
    source: 'discovery',
  };
}
