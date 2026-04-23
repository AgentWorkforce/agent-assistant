import { describe, expect, it } from 'vitest';
import { isInQuietHours, shouldDeferForQuietHours } from './quiet-hours.js';
import type { QuietHoursConfig, QuietHoursStore } from './quiet-hours.js';

const NEW_YORK_TIMEZONE = 'America/New_York';
const VALIDATION_INSTANT = new Date('2026-01-15T12:00:00.000Z');

function validateConfig(config: QuietHoursConfig): void {
  isInQuietHours(config, VALIDATION_INSTANT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfig(value: unknown): QuietHoursConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const { timezone, startHour, endHour } = value;
  if (
    typeof timezone !== 'string' ||
    typeof startHour !== 'number' ||
    typeof endHour !== 'number'
  ) {
    return null;
  }

  const config = { timezone, startHour, endHour };
  try {
    validateConfig(config);
    return config;
  } catch {
    return null;
  }
}

class FakeQuietHoursStore implements QuietHoursStore {
  private readonly records = new Map<string, string>();

  async get(userId: string): Promise<QuietHoursConfig | null> {
    const blob = this.records.get(userId);
    if (blob === undefined) {
      return null;
    }

    try {
      return parseConfig(JSON.parse(blob));
    } catch {
      return null;
    }
  }

  async set(userId: string, config: QuietHoursConfig): Promise<void> {
    validateConfig(config);
    this.records.set(userId, JSON.stringify(config));
  }

  setRaw(userId: string, blob: string): void {
    this.records.set(userId, blob);
  }
}

describe('quiet hours', () => {
  it('is true when the local hour equals startHour in the configured timezone', () => {
    const now = new Date('2026-01-15T14:00:00.000Z'); // 09:00 in America/New_York

    expect(
      isInQuietHours(
        { timezone: NEW_YORK_TIMEZONE, startHour: 9, endHour: 17 },
        now,
      ),
    ).toBe(true);
  });

  it('is false when the local hour equals endHour because the window is half-open', () => {
    const now = new Date('2026-01-15T22:00:00.000Z'); // 17:00 in America/New_York

    expect(
      isInQuietHours(
        { timezone: NEW_YORK_TIMEZONE, startHour: 9, endHour: 17 },
        now,
      ),
    ).toBe(false);
  });

  it('handles quiet windows that wrap midnight', () => {
    const config = { timezone: NEW_YORK_TIMEZONE, startHour: 22, endHour: 8 };

    expect(isInQuietHours(config, new Date('2026-01-16T04:00:00.000Z'))).toBe(
      true,
    ); // 23:00 in America/New_York
    expect(isInQuietHours(config, new Date('2026-01-15T08:00:00.000Z'))).toBe(
      true,
    ); // 03:00 in America/New_York
    expect(isInQuietHours(config, new Date('2026-01-15T14:00:00.000Z'))).toBe(
      false,
    ); // 09:00 in America/New_York
  });

  it('does not defer when the store has no quiet-hours config', async () => {
    const store = new FakeQuietHoursStore();

    await expect(
      shouldDeferForQuietHours(
        store,
        'user-1',
        new Date('2026-01-15T14:00:00.000Z'),
      ),
    ).resolves.toBe(false);
  });

  it('defers for a configured user inside their quiet window', async () => {
    const store = new FakeQuietHoursStore();
    await store.set('user-1', {
      timezone: NEW_YORK_TIMEZONE,
      startHour: 9,
      endHour: 17,
    });

    await expect(
      shouldDeferForQuietHours(
        store,
        'user-1',
        new Date('2026-01-15T14:00:00.000Z'),
      ),
    ).resolves.toBe(true);
  });

  it('validates config on set', async () => {
    const store = new FakeQuietHoursStore();

    await expect(
      store.set('bad-hour', {
        timezone: NEW_YORK_TIMEZONE,
        startHour: 25,
        endHour: 8,
      }),
    ).rejects.toThrow();

    await expect(
      store.set('bad-timezone', {
        timezone: 'America/No_Such_Zone',
        startHour: 22,
        endHour: 8,
      }),
    ).rejects.toThrow();

    await expect(
      store.set('non-integer-hour', {
        timezone: NEW_YORK_TIMEZONE,
        startHour: 22.5,
        endHour: 8,
      }),
    ).rejects.toThrow();
  });

  it('returns null when the stored blob is malformed', async () => {
    const store = new FakeQuietHoursStore();

    store.setRaw('bad-json', '{bad json');
    store.setRaw(
      'schema-miss',
      JSON.stringify({ timezone: NEW_YORK_TIMEZONE, startHour: 22 }),
    );

    await expect(store.get('bad-json')).resolves.toBeNull();
    await expect(store.get('schema-miss')).resolves.toBeNull();
  });
});
