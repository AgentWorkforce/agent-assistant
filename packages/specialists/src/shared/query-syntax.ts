export interface ParsedQuery {
  text: string;
  filters: Record<string, string[]>;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TYPE_VALUES = new Set(['pr', 'issue']);
const STATE_VALUES = new Set(['open', 'closed']);

function addFilter(filters: Record<string, string[]>, key: string, value: string): void {
  const values = filters[key] ?? [];
  values.push(value);
  filters[key] = values;
}

function normalizeFilter(token: string): { key: string; value: string } | null {
  const separatorIndex = token.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  const key = token.slice(0, separatorIndex).toLowerCase();
  const value = token.slice(separatorIndex + 1);

  if (key === 'repo' && REPO_PATTERN.test(value)) {
    return { key, value };
  }

  if (key === 'label') {
    return { key, value };
  }

  const normalizedValue = value.toLowerCase();

  if (key === 'state' && STATE_VALUES.has(normalizedValue)) {
    return { key, value: normalizedValue };
  }

  if (key === 'type' && TYPE_VALUES.has(normalizedValue)) {
    return { key, value: normalizedValue };
  }

  return null;
}

export function parseQuery(input: string): ParsedQuery {
  const filters: Record<string, string[]> = {};
  const textParts: string[] = [];

  for (const token of input.trim().split(/\s+/)) {
    if (token.length === 0) {
      continue;
    }

    const filter = normalizeFilter(token);
    if (filter) {
      addFilter(filters, filter.key, filter.value);
      continue;
    }

    textParts.push(token);
  }

  return {
    text: textParts.join(' '),
    filters,
  };
}
