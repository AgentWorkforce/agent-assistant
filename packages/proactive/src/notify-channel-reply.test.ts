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
  it('returns normalized name when input starts with #', () => {
    expect(parseRedirectChannelName('#foo-bar')).toBe('foo-bar');
    expect(parseRedirectChannelName('#FooBar')).toBe('foobar');
  });
  it('returns undefined when input does not start with #', () => {
    expect(parseRedirectChannelName('foo')).toBeUndefined();
  });
  it('rejects invalid characters', () => {
    expect(parseRedirectChannelName('#foo bar')).toBeUndefined();
    expect(parseRedirectChannelName('#foo/bar')).toBeUndefined();
  });
});

describe('parseConfirmReply', () => {
  it('classifies yes/y/confirm as confirm', () => {
    expect(parseConfirmReply('yes')).toEqual({ kind: 'confirm' });
    expect(parseConfirmReply('Y')).toEqual({ kind: 'confirm' });
    expect(parseConfirmReply(' Confirm ')).toEqual({ kind: 'confirm' });
  });
  it('classifies #channel as redirect', () => {
    expect(parseConfirmReply('#incidents')).toEqual({ kind: 'redirect', channelName: 'incidents' });
  });
  it('classifies unrelated text as none', () => {
    expect(parseConfirmReply('maybe later')).toEqual({ kind: 'none' });
    expect(parseConfirmReply('')).toEqual({ kind: 'none' });
    expect(parseConfirmReply('#')).toEqual({ kind: 'none' });
  });
});
