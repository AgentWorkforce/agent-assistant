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
