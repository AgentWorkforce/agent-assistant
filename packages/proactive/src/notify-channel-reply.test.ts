import { describe, expect, it } from 'vitest';

import {
  normalizeChannelName,
  parseConfirmReply,
  parseRedirectChannelName,
} from './notify-channel-reply.js';

describe('normalizeChannelName', () => {
  it('strips leading # and lowercases', () => {
    expect(normalizeChannelName('#General')).toBe('general');
    expect(normalizeChannelName('  #Foo ')).toBe('foo');
  });
});

describe('parseRedirectChannelName', () => {
  it('accepts literal #channel-name and returns channelName', () => {
    expect(parseRedirectChannelName('#foo-bar')).toEqual({ channelName: 'foo-bar' });
    expect(parseRedirectChannelName('#FooBar')).toEqual({ channelName: 'foobar' });
  });

  it('accepts Slack-rewritten mention with id and name', () => {
    expect(parseRedirectChannelName('<#C123|general>')).toEqual({
      channelId: 'C123',
      channelName: 'general',
    });
  });

  it('accepts Slack-rewritten mention with id only', () => {
    expect(parseRedirectChannelName('<#C123>')).toEqual({ channelId: 'C123' });
  });

  it('normalizes the name portion of a Slack mention', () => {
    expect(parseRedirectChannelName('<#C123|General>')).toEqual({
      channelId: 'C123',
      channelName: 'general',
    });
  });

  it('returns undefined when input does not start with # or <#', () => {
    expect(parseRedirectChannelName('foo')).toBeUndefined();
    expect(parseRedirectChannelName('')).toBeUndefined();
  });

  it('rejects invalid characters in the literal form', () => {
    expect(parseRedirectChannelName('#foo bar')).toBeUndefined();
    expect(parseRedirectChannelName('#foo/bar')).toBeUndefined();
  });

  it('rejects malformed Slack mentions', () => {
    expect(parseRedirectChannelName('<#>')).toBeUndefined();
    expect(parseRedirectChannelName('<#lowercase>')).toBeUndefined();
  });
});

describe('parseConfirmReply', () => {
  it('classifies yes/y/confirm as confirm', () => {
    expect(parseConfirmReply('yes')).toEqual({ kind: 'confirm' });
    expect(parseConfirmReply('Y')).toEqual({ kind: 'confirm' });
    expect(parseConfirmReply(' Confirm ')).toEqual({ kind: 'confirm' });
  });

  it('classifies literal #channel as redirect with channelName', () => {
    expect(parseConfirmReply('#incidents')).toEqual({
      kind: 'redirect',
      channelName: 'incidents',
    });
  });

  it('classifies Slack-rewritten mention as redirect with id and name', () => {
    expect(parseConfirmReply('<#C123|incidents>')).toEqual({
      kind: 'redirect',
      channelId: 'C123',
      channelName: 'incidents',
    });
  });

  it('classifies unrelated text as none', () => {
    expect(parseConfirmReply('maybe later')).toEqual({ kind: 'none' });
    expect(parseConfirmReply('')).toEqual({ kind: 'none' });
    expect(parseConfirmReply('#')).toEqual({ kind: 'none' });
    expect(parseConfirmReply('<#>')).toEqual({ kind: 'none' });
  });
});
