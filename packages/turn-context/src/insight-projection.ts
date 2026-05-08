import type { TurnPreparedContextBlock } from './types.js';

export interface InsightFreshness {
  ttlSeconds?: number;
  staleAt?: string;
}

export interface InsightEnvelope<TBody = unknown> {
  schemaVersion: string;
  generatedAt: string;
  sourceProvider: string;
  sourcePaths: string[];
  freshness?: InsightFreshness;
  body: TBody;
}

export interface InsightProjectionInput<TBody = unknown> {
  envelope: InsightEnvelope<TBody>;
  preview?: { maxChars: number };
}

function stringifyBody(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }

  if (
    typeof body === 'number' ||
    typeof body === 'boolean' ||
    body === null ||
    Array.isArray(body) ||
    (typeof body === 'object' && body !== null)
  ) {
    return JSON.stringify(body, null, 2);
  }

  return String(body);
}

function applyPreview(content: string, maxChars: number | undefined): string {
  if (maxChars === undefined) {
    return content;
  }

  const limit = Math.max(0, Math.floor(maxChars));
  return content.length > limit ? content.slice(0, limit) : content;
}

function toBlockId(envelope: InsightEnvelope): string {
  const rawId = `${envelope.sourceProvider}-${envelope.generatedAt}`;
  return `insight-${rawId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/(^-|-$)/gu, '')}`;
}

export function projectInsightAsContextBlock<TBody = unknown>(
  input: InsightProjectionInput<TBody>,
): TurnPreparedContextBlock {
  const { envelope } = input;

  return {
    id: toBlockId(envelope),
    label: `Insight (${envelope.sourceProvider})`,
    content: applyPreview(stringifyBody(envelope.body), input.preview?.maxChars),
    source: envelope.sourceProvider,
    category: 'other',
    metadata: {
      schemaVersion: envelope.schemaVersion,
      generatedAt: envelope.generatedAt,
      sourceProvider: envelope.sourceProvider,
      sourcePaths: [...envelope.sourcePaths],
      ...(envelope.freshness !== undefined ? { freshness: { ...envelope.freshness } } : {}),
    },
  };
}
