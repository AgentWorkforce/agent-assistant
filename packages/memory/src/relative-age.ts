const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function toDate(value: string | Date | number | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeAge(
  entry: { createdAt?: string | Date | number },
  now = new Date(),
): string {
  const createdAt = toDate(entry.createdAt);
  if (!createdAt) {
    return 'unknown age';
  }

  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  if (ageMs < MINUTE_MS) {
    return 'just now';
  }

  if (ageMs < HOUR_MS) {
    return pluralize(Math.floor(ageMs / MINUTE_MS), 'minute');
  }

  if (ageMs < DAY_MS) {
    return pluralize(Math.floor(ageMs / HOUR_MS), 'hour');
  }

  if (ageMs < WEEK_MS) {
    return pluralize(Math.floor(ageMs / DAY_MS), 'day');
  }

  if (ageMs < MONTH_MS) {
    return pluralize(Math.floor(ageMs / WEEK_MS), 'week');
  }

  if (ageMs < YEAR_MS) {
    return pluralize(Math.floor(ageMs / MONTH_MS), 'month');
  }

  return pluralize(Math.floor(ageMs / YEAR_MS), 'year');
}
