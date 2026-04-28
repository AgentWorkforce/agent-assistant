import { describe, expect, it } from 'vitest';

import { formatRelativeAge } from './relative-age.js';

describe('formatRelativeAge', () => {
  const now = new Date('2026-04-27T12:00:00.000Z');

  it('returns just now for entries less than 60 seconds old', () => {
    expect(formatRelativeAge({ createdAt: '2026-04-27T11:59:01.000Z' }, now)).toBe('just now');
  });

  it('formats minute and hour boundaries correctly', () => {
    expect(formatRelativeAge({ createdAt: '2026-04-27T11:59:00.000Z' }, now)).toBe('1 minute ago');
    expect(formatRelativeAge({ createdAt: '2026-04-27T11:01:00.000Z' }, now)).toBe('59 minutes ago');
    expect(formatRelativeAge({ createdAt: '2026-04-27T11:00:00.000Z' }, now)).toBe('1 hour ago');
  });

  it('formats singular and plural units correctly', () => {
    expect(formatRelativeAge({ createdAt: '2026-04-27T10:00:00.000Z' }, now)).toBe('2 hours ago');
    expect(formatRelativeAge({ createdAt: '2026-04-26T12:00:00.000Z' }, now)).toBe('1 day ago');
    expect(formatRelativeAge({ createdAt: '2026-04-25T12:00:00.000Z' }, now)).toBe('2 days ago');
    expect(formatRelativeAge({ createdAt: '2026-04-20T12:00:00.000Z' }, now)).toBe('1 week ago');
    expect(formatRelativeAge({ createdAt: '2026-03-28T12:00:00.000Z' }, now)).toBe('1 month ago');
    expect(formatRelativeAge({ createdAt: '2025-04-27T12:00:00.000Z' }, now)).toBe('1 year ago');
  });

  it('accepts string, Date, and epoch-millisecond createdAt values', () => {
    expect(formatRelativeAge({ createdAt: '2026-04-27T11:59:00.000Z' }, now)).toBe('1 minute ago');
    expect(formatRelativeAge({ createdAt: new Date('2026-04-20T12:00:00.000Z') }, now)).toBe(
      '1 week ago',
    );
    expect(formatRelativeAge({ createdAt: Date.parse('2026-04-27T10:00:00.000Z') }, now)).toBe(
      '2 hours ago',
    );
  });

  it('returns unknown age for missing or unparseable timestamps', () => {
    expect(formatRelativeAge({}, now)).toBe('unknown age');
    expect(formatRelativeAge({ createdAt: 'not-a-date' }, now)).toBe('unknown age');
  });
});
