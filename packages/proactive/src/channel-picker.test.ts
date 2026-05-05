import type { BotChannel } from '@agent-assistant/surfaces';
import { describe, expect, it, vi } from 'vitest';

import { pickChannel, type ChatFn, type ProactivePayload } from './channel-picker.js';

const payload: ProactivePayload = {
  kind: 'follow-up',
  topic: 'incident retro',
  preview: 'Summary of incident X',
};

const channels: BotChannel[] = [
  { id: 'C_ENG', name: 'engineering' },
  { id: 'C_INC', name: 'incidents', topic: 'incident response' },
];

function mockChat(content: string): ChatFn {
  return vi.fn(async () => ({ content }));
}

describe('pickChannel', () => {
  it('returns null for empty channels', async () => {
    const chat = mockChat('');
    expect(await pickChannel(chat, [], payload)).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it('returns the only channel with confidence 1.0 without calling chat', async () => {
    const chat = mockChat('');
    const picked = await pickChannel(chat, [channels[0]], payload);
    expect(picked).toEqual({
      channelId: 'C_ENG',
      channelName: 'engineering',
      confidence: 1,
      reason: 'only channel',
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it('parses a valid JSON response and returns the matched channel', async () => {
    const chat = mockChat(
      JSON.stringify({ channelId: 'C_INC', confidence: 0.9, reason: 'topic matches' }),
    );
    const picked = await pickChannel(chat, channels, payload);
    expect(picked).toEqual({
      channelId: 'C_INC',
      channelName: 'incidents',
      confidence: 0.9,
      reason: 'topic matches',
    });
  });

  it('falls back to the first channel when the response is invalid JSON', async () => {
    const chat = mockChat('not json at all');
    const picked = await pickChannel(chat, channels, payload);
    expect(picked).toMatchObject({
      channelId: 'C_ENG',
      confidence: 0.3,
      reason: 'llm-parse-fallback',
    });
  });

  it('falls back when the LLM picks an unknown channelId', async () => {
    const chat = mockChat(
      JSON.stringify({ channelId: 'C_MISSING', confidence: 0.8, reason: 'whatever' }),
    );
    const picked = await pickChannel(chat, channels, payload);
    expect(picked).toMatchObject({ channelId: 'C_ENG', reason: 'llm-parse-fallback' });
  });

  it('falls back when chat throws', async () => {
    const chat: ChatFn = vi.fn(async () => {
      throw new Error('boom');
    });
    const picked = await pickChannel(chat, channels, payload);
    expect(picked).toMatchObject({ channelId: 'C_ENG', reason: 'llm-parse-fallback' });
  });

  it('rejects out-of-range confidence', async () => {
    const chat = mockChat(
      JSON.stringify({ channelId: 'C_INC', confidence: 1.5, reason: 'topic matches' }),
    );
    const picked = await pickChannel(chat, channels, payload);
    expect(picked).toMatchObject({ channelId: 'C_ENG', reason: 'llm-parse-fallback' });
  });

  it('truncates the reason to 15 words', async () => {
    const longReason = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
    const chat = mockChat(
      JSON.stringify({ channelId: 'C_INC', confidence: 0.5, reason: longReason }),
    );
    const picked = await pickChannel(chat, channels, payload);
    expect(picked?.reason.split(/\s+/).length).toBe(15);
  });

  // Smarter fallback (PR notes the prod symptom: every fresh workspace was
  // landing on whichever channel happened to be first in the bot's joined
  // list, usually random). When the LLM declines or errors, prefer
  // `#general` (case-insensitive) before the first joined channel.
  describe('fallback prefers #general', () => {
    const channelsWithGeneral: BotChannel[] = [
      { id: 'C_RANDOM', name: 'random' },
      { id: 'C_GENERAL', name: 'general' },
      { id: 'C_ENG', name: 'engineering' },
    ];

    it('picks #general when LLM returns invalid JSON and the bot is a member of #general', async () => {
      const chat = mockChat('not json at all');
      const picked = await pickChannel(chat, channelsWithGeneral, payload);
      expect(picked).toMatchObject({
        channelId: 'C_GENERAL',
        confidence: 0.3,
        reason: 'llm-parse-fallback',
      });
    });

    it('picks #general when chat throws', async () => {
      const chat: ChatFn = vi.fn(async () => {
        throw new Error('boom');
      });
      const picked = await pickChannel(chat, channelsWithGeneral, payload);
      expect(picked?.channelId).toBe('C_GENERAL');
    });

    it('matches #general case-insensitively', async () => {
      const list: BotChannel[] = [
        { id: 'C_ENG', name: 'engineering' },
        { id: 'C_GENERAL', name: 'General' },
      ];
      const chat = mockChat('not json');
      const picked = await pickChannel(chat, list, payload);
      expect(picked?.channelId).toBe('C_GENERAL');
    });

    it('falls back to the first channel when #general is not present', async () => {
      const list: BotChannel[] = [
        { id: 'C_ENG', name: 'engineering' },
        { id: 'C_DESIGN', name: 'design' },
      ];
      const chat = mockChat('not json');
      const picked = await pickChannel(chat, list, payload);
      expect(picked?.channelId).toBe('C_ENG');
    });
  });
});
