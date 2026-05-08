import type { VfsProvider } from '../types.js';

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

export type VirtualFileSystem = VfsProvider;

export type InsightReadResult<TBody = unknown> =
  | { ok: true; envelope: InsightEnvelope<TBody> }
  | {
      ok: false;
      reason: 'missing' | 'malformed' | 'unsupported_schema';
      partial?: Partial<InsightEnvelope<TBody>>;
    };
