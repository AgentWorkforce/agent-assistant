/**
 * LLM-driven picker that selects the best Slack channel for a proactive message
 * when the bot is a member of multiple channels.
 *
 * Consumers inject a {@link ChatFn} so the picker is agnostic to which LLM
 * provider is used. Typical wiring points it at a cheap classifier model
 * (Haiku, GPT-5-mini, etc.) with temperature 0.
 */

import type { BotChannel } from '@agent-assistant/surfaces';

export interface ProactivePayload {
  kind: 'follow-up' | 'stale-thread' | 'context-change' | 'pr-match';
  topic: string;
  preview: string;
}

export interface PickedChannel {
  channelId: string;
  channelName: string;
  confidence: number;
  reason: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
}

export type ChatFn = (
  messages: ChatMessage[],
  options?: ChatOptions,
) => Promise<{ content: string }>;

const CHANNEL_PICKER_SYSTEM_PROMPT =
  'Pick the Slack channel that is the best fit for this proactive message. Prefer topic-matched channels. Return strict JSON {channelId, confidence (0..1), reason (<=15 words)}.';
const FALLBACK_CONFIDENCE = 0.3;
const FALLBACK_REASON = 'llm-parse-fallback';
const MAX_REASON_WORDS = 15;

interface ChannelPickJson {
  channelId?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

function extractJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return value.slice(start, end + 1);
}

function channelToPick(channel: BotChannel, confidence: number, reason: string): PickedChannel {
  return {
    channelId: channel.id,
    channelName: channel.name,
    confidence,
    reason,
  };
}

function fallbackChannel(channel: BotChannel): PickedChannel {
  return channelToPick(channel, FALLBACK_CONFIDENCE, FALLBACK_REASON);
}

function limitReason(value: string): string {
  return value.trim().split(/\s+/).slice(0, MAX_REASON_WORDS).join(' ');
}

function parsePickedChannel(content: string, channels: BotChannel[]): PickedChannel | null {
  const json = extractJsonObject(content);
  if (!json) {
    return null;
  }

  let parsed: ChannelPickJson;
  try {
    parsed = JSON.parse(json) as ChannelPickJson;
  } catch {
    return null;
  }

  if (typeof parsed.channelId !== 'string' || parsed.channelId.trim().length === 0) {
    return null;
  }
  const channelId = parsed.channelId.trim();

  if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)) {
    return null;
  }
  if (parsed.confidence < 0 || parsed.confidence > 1) {
    return null;
  }

  if (typeof parsed.reason !== 'string' || parsed.reason.trim().length === 0) {
    return null;
  }

  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!channel) {
    return null;
  }

  return channelToPick(channel, parsed.confidence, limitReason(parsed.reason));
}

function buildUserPrompt(channels: BotChannel[], payload: ProactivePayload): string {
  return JSON.stringify(
    {
      payload,
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        topic: channel.topic ?? '',
        purpose: channel.purpose ?? '',
        numMembers: channel.numMembers ?? null,
      })),
    },
    null,
    2,
  );
}

export async function pickChannel(
  chat: ChatFn,
  channels: BotChannel[],
  payload: ProactivePayload,
): Promise<PickedChannel | null> {
  const [first, ...rest] = channels;
  if (!first) {
    return null;
  }

  if (rest.length === 0) {
    return channelToPick(first, 1.0, 'only channel');
  }

  try {
    const response = await chat(
      [
        { role: 'system', content: CHANNEL_PICKER_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(channels, payload) },
      ],
      { temperature: 0 },
    );
    return parsePickedChannel(response.content, channels) ?? fallbackChannel(first);
  } catch {
    return fallbackChannel(first);
  }
}
