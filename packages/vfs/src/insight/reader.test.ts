import { describe, expect, it } from 'vitest';

import { readInsightEnvelope } from '../index.js';
import type { InsightEnvelope, VfsProvider } from '../index.js';

class InMemoryVfs implements VfsProvider {
  constructor(private readonly files: Record<string, string>) {}

  async list() {
    return [];
  }

  async read(path: string) {
    const content = this.files[path];
    return content === undefined ? null : { path, content };
  }

  async search() {
    return [];
  }
}

describe('readInsightEnvelope', () => {
  it('reads a valid insight envelope and preserves provenance fields', async () => {
    const envelope: InsightEnvelope<{ summary: string }> = {
      schemaVersion: 'insight/v1',
      generatedAt: '2026-05-07T12:00:00.000Z',
      sourceProvider: 'relayfile',
      sourcePaths: ['/insights/pr-123.json'],
      freshness: {
        ttlSeconds: 600,
        staleAt: '2026-05-07T12:10:00.000Z',
      },
      body: {
        summary: 'A concise summary.',
      },
    };

    const result = await readInsightEnvelope<{ summary: string }>(
      new InMemoryVfs({
        '/insights/pr-123.json': JSON.stringify(envelope),
      }),
      '/insights/pr-123.json',
    );

    expect(result).toEqual({
      ok: true,
      envelope,
    });
  });

  it('returns missing when the file does not exist', async () => {
    const result = await readInsightEnvelope(new InMemoryVfs({}), '/insights/missing.json');

    expect(result).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('returns malformed with partial fields for partial artifacts', async () => {
    const result = await readInsightEnvelope(
      new InMemoryVfs({
        '/insights/partial.json': JSON.stringify({
          schemaVersion: 'insight/v1',
          generatedAt: '2026-05-07T12:00:00.000Z',
          sourceProvider: 'relayfile',
          sourcePaths: ['/insights/partial.json'],
        }),
      }),
      '/insights/partial.json',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'malformed',
      partial: {
        schemaVersion: 'insight/v1',
        generatedAt: '2026-05-07T12:00:00.000Z',
        sourceProvider: 'relayfile',
        sourcePaths: ['/insights/partial.json'],
      },
    });
  });

  it('returns malformed with partial fields salvaged from malformed json', async () => {
    const result = await readInsightEnvelope(
      new InMemoryVfs({
        '/insights/broken.json': `{
  "schemaVersion": "insight/v1",
  "generatedAt": "2026-05-07T12:00:00.000Z",
  "sourceProvider": "relayfile",
  "sourcePaths": ["/insights/broken.json"],
  "freshness": { "ttlSeconds": 600 },
  "body": {
`,
      }),
      '/insights/broken.json',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'malformed',
      partial: {
        schemaVersion: 'insight/v1',
        generatedAt: '2026-05-07T12:00:00.000Z',
        sourceProvider: 'relayfile',
        sourcePaths: ['/insights/broken.json'],
        freshness: { ttlSeconds: 600 },
      },
    });
  });

  it('returns unsupported_schema for unknown schema versions', async () => {
    const result = await readInsightEnvelope(
      new InMemoryVfs({
        '/insights/future.json': JSON.stringify({
          schemaVersion: 'insight/v2',
          generatedAt: '2026-05-07T12:00:00.000Z',
          sourceProvider: 'relayfile',
          sourcePaths: ['/insights/future.json'],
          body: {
            summary: 'Future schema.',
          },
        }),
      }),
      '/insights/future.json',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'unsupported_schema',
      partial: {
        schemaVersion: 'insight/v2',
        generatedAt: '2026-05-07T12:00:00.000Z',
        sourceProvider: 'relayfile',
        sourcePaths: ['/insights/future.json'],
        body: {
          summary: 'Future schema.',
        },
      },
    });
  });
});
