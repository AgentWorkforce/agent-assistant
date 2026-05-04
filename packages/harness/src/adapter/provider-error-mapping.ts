import type { HarnessInvalidOutputCode } from '../types.js';

export type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function classifyProviderError(
  httpStatus: number | undefined,
  message: string | undefined,
): HarnessInvalidOutputCode {
  const text = (message ?? '').toLowerCase();
  if (text.includes('credit') || text.includes('billing') || text.includes('quota')) {
    return 'credits_exhausted';
  }
  if (
    text.includes('context length') ||
    text.includes('context_length') ||
    text.includes('maximum context') ||
    text.includes('token limit') ||
    text.includes('too many tokens')
  ) {
    return 'context_length_exceeded';
  }
  if (text.includes('model') && (text.includes('not found') || text.includes('unknown'))) {
    return 'model_not_found';
  }
  if (text.includes('rate limit') || text.includes('too many request')) {
    return 'rate_limited';
  }
  if (text.includes('timeout') || text.includes('timed out') || text.includes('aborted')) {
    return 'timeout';
  }

  switch (httpStatus) {
    case 400:
      return 'invalid_request';
    case 401:
    case 403:
      return 'auth_failed';
    case 402:
      return 'credits_exhausted';
    case 404:
      return 'model_not_found';
    case 408:
    case 504:
      return 'timeout';
    case 429:
      return 'rate_limited';
    default:
      return 'unknown';
  }
}

export function isTransientProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readJsonResponse(response: Response): Promise<{
  text: string;
  json?: Record<string, unknown>;
}> {
  const text = await response.text();
  if (!text.trim()) {
    return { text };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return { text, json: isRecord(parsed) ? parsed : undefined };
  } catch {
    return { text };
  }
}

export function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === '') return {};
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parses Server-Sent Events frames out of a Response body. Yields the raw
 * `data:` payload string for every event in order, handling UTF-8 byte
 * boundaries and chunk-split frames. Multi-line `data:` values within a
 * single frame are joined with `\n`.
 *
 * Workers-fetch rule: callers MUST cancel the response body if they exit
 * early — this iterator releases the reader on completion.
 */
export async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length > 0) {
          yield dataLines.join('\n');
        }
        idx = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data:')) {
      yield trimmed.slice(5).trim();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignored — lock may already be released.
    }
  }
}

export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
