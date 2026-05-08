declare module '@agent-assistant/vfs' {
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
}
