export interface QuietHoursConfig {
  timezone: string;
  startHour: number;
  endHour: number;
}

export interface QuietHoursStore {
  get(userId: string): Promise<QuietHoursConfig | null>;
  set(userId: string, config: QuietHoursConfig): Promise<void>;
}

const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_]+){1,2})$/;

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function assertHour(name: string, hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`${name} must be an integer from 0 to 23`);
  }
}

function getHourFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = hourFormatters.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  });
  hourFormatters.set(timezone, formatter);
  return formatter;
}

function assertTimezone(timezone: string): void {
  if (!TIMEZONE_PATTERN.test(timezone)) {
    throw new Error('timezone must be an IANA-looking timezone');
  }

  try {
    getHourFormatter(timezone);
  } catch (err) {
    throw new Error(`timezone is not supported: ${timezone}`, { cause: err });
  }
}

function assertValidConfig(config: QuietHoursConfig): void {
  assertTimezone(config.timezone);
  assertHour('startHour', config.startHour);
  assertHour('endHour', config.endHour);
}

function getLocalHour(timezone: string, now: Date): number {
  const hourPart = getHourFormatter(timezone)
    .formatToParts(now)
    .find((part) => part.type === 'hour');

  if (!hourPart) {
    throw new Error(`Unable to extract local hour for timezone: ${timezone}`);
  }

  const hour = Number(hourPart.value);
  assertHour('local hour', hour);
  return hour;
}

export function isInQuietHours(config: QuietHoursConfig, now: Date): boolean {
  assertValidConfig(config);

  const localHour = getLocalHour(config.timezone, now);
  if (config.startHour === config.endHour) {
    return false;
  }

  if (config.endHour < config.startHour) {
    return localHour >= config.startHour || localHour < config.endHour;
  }

  return localHour >= config.startHour && localHour < config.endHour;
}

export async function shouldDeferForQuietHours(
  store: QuietHoursStore,
  userId: string,
  now: Date,
): Promise<boolean> {
  const config = await store.get(userId);
  if (config === null) {
    return false;
  }

  return isInQuietHours(config, now);
}
