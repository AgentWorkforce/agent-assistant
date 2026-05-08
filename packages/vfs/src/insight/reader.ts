import type { InsightEnvelope, InsightFreshness, InsightReadResult, VirtualFileSystem } from './envelope.js';

const SUPPORTED_SCHEMA_VERSION = 'insight/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseFreshness(value: unknown): InsightFreshness | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const freshness: InsightFreshness = {};
  if (typeof value.ttlSeconds === 'number' && Number.isFinite(value.ttlSeconds)) {
    freshness.ttlSeconds = value.ttlSeconds;
  }
  if (typeof value.staleAt === 'string') {
    freshness.staleAt = value.staleAt;
  }

  return Object.keys(freshness).length > 0 ? freshness : undefined;
}

function toPartialEnvelope<TBody = unknown>(value: Record<string, unknown>): Partial<InsightEnvelope<TBody>> {
  const partial: Partial<InsightEnvelope<TBody>> = {};

  if (typeof value.schemaVersion === 'string') {
    partial.schemaVersion = value.schemaVersion;
  }
  if (typeof value.generatedAt === 'string') {
    partial.generatedAt = value.generatedAt;
  }
  if (typeof value.sourceProvider === 'string') {
    partial.sourceProvider = value.sourceProvider;
  }
  if (isStringArray(value.sourcePaths)) {
    partial.sourcePaths = [...value.sourcePaths];
  }

  const freshness = parseFreshness(value.freshness);
  if (freshness !== undefined) {
    partial.freshness = freshness;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'body')) {
    partial.body = value.body as TBody;
  }

  return partial;
}

function skipWhitespace(raw: string, index: number): number {
  let cursor = index;
  while (cursor < raw.length && /\s/u.test(raw[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function readStringValue(raw: string, start: number): string | undefined {
  let cursor = start + 1;
  let escaped = false;

  while (cursor < raw.length) {
    const char = raw[cursor];
    if (char === undefined) {
      return undefined;
    }

    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      cursor += 1;
      continue;
    }

    if (char === '"') {
      return raw.slice(start, cursor + 1);
    }

    cursor += 1;
  }

  return undefined;
}

function readBalancedValue(raw: string, start: number, openChar: '{' | '[', closeChar: '}' | ']'): string | undefined {
  let cursor = start;
  let depth = 0;
  let inString = false;
  let escaped = false;

  while (cursor < raw.length) {
    const char = raw[cursor];
    if (char === undefined) {
      return undefined;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      cursor += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      cursor += 1;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, cursor + 1);
      }
    }

    cursor += 1;
  }

  return undefined;
}

function readPrimitiveValue(raw: string, start: number): string | undefined {
  let cursor = start;
  while (cursor < raw.length) {
    const char = raw[cursor];
    if (char === undefined || char === ',' || char === '}' || char === ']') {
      break;
    }
    cursor += 1;
  }

  const fragment = raw.slice(start, cursor).trim();
  return fragment.length > 0 ? fragment : undefined;
}

function extractKeyValue(raw: string, key: string): unknown {
  const keyPattern = new RegExp(`"${key}"\\s*:`, 'u');
  const match = keyPattern.exec(raw);
  if (match?.index === undefined) {
    return undefined;
  }

  const valueStart = skipWhitespace(raw, match.index + match[0].length);
  const firstChar = raw[valueStart];

  let fragment: string | undefined;
  if (firstChar === '"') {
    fragment = readStringValue(raw, valueStart);
  } else if (firstChar === '{') {
    fragment = readBalancedValue(raw, valueStart, '{', '}');
  } else if (firstChar === '[') {
    fragment = readBalancedValue(raw, valueStart, '[', ']');
  } else {
    fragment = readPrimitiveValue(raw, valueStart);
  }

  if (!fragment) {
    return undefined;
  }

  try {
    return JSON.parse(fragment);
  } catch {
    return undefined;
  }
}

function extractPartialFromMalformedJson<TBody = unknown>(raw: string): Partial<InsightEnvelope<TBody>> | undefined {
  const source: Record<string, unknown> = {};
  for (const key of ['schemaVersion', 'generatedAt', 'sourceProvider', 'sourcePaths', 'freshness', 'body']) {
    const value = extractKeyValue(raw, key);
    if (value !== undefined) {
      source[key] = value;
    }
  }

  const partial = toPartialEnvelope<TBody>(source);
  return Object.keys(partial).length > 0 ? partial : undefined;
}

function isValidEnvelope<TBody = unknown>(
  partial: Partial<InsightEnvelope<TBody>>,
): partial is InsightEnvelope<TBody> {
  if (typeof partial.schemaVersion !== 'string') {
    return false;
  }
  if (typeof partial.generatedAt !== 'string') {
    return false;
  }
  if (typeof partial.sourceProvider !== 'string') {
    return false;
  }
  if (!Array.isArray(partial.sourcePaths) || partial.sourcePaths.some((item) => typeof item !== 'string')) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(partial, 'body')) {
    return false;
  }
  if (
    partial.freshness !== undefined &&
    (typeof partial.freshness !== 'object' || partial.freshness === null || Array.isArray(partial.freshness))
  ) {
    return false;
  }

  return true;
}

export async function readInsightEnvelope<TBody = unknown>(
  vfs: VirtualFileSystem,
  path: string,
): Promise<InsightReadResult<TBody>> {
  const entry = await vfs.read(path);
  if (entry === null) {
    return { ok: false, reason: 'missing' };
  }

  try {
    const parsed = JSON.parse(entry.content) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, reason: 'malformed' };
    }

    const partial = toPartialEnvelope<TBody>(parsed);
    if (!isValidEnvelope(partial)) {
      return {
        ok: false,
        reason: 'malformed',
        ...(Object.keys(partial).length > 0 ? { partial } : {}),
      };
    }

    if (partial.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'unsupported_schema',
        partial,
      };
    }

    return {
      ok: true,
      envelope: partial,
    };
  } catch {
    const partial = extractPartialFromMalformedJson<TBody>(entry.content);
    return {
      ok: false,
      reason: 'malformed',
      ...(partial !== undefined ? { partial } : {}),
    };
  }
}
