import { describe, expect, it } from 'vitest';

import { projectInsightAsContextBlock, type InsightEnvelope } from './insight-projection.js';

describe('projectInsightAsContextBlock', () => {
  it('preserves provenance fields in block metadata', () => {
    const envelope: InsightEnvelope<{ summary: string }> = {
      schemaVersion: 'insight/v1',
      generatedAt: '2026-05-07T12:00:00.000Z',
      sourceProvider: 'relayfile',
      sourcePaths: ['/insights/pr-123.json', '/insights/supporting.txt'],
      freshness: {
        ttlSeconds: 600,
        staleAt: '2026-05-07T12:10:00.000Z',
      },
      body: {
        summary: 'Insight summary.',
      },
    };

    const block = projectInsightAsContextBlock({ envelope });

    expect(block).toMatchObject({
      label: 'Insight (relayfile)',
      source: 'relayfile',
      category: 'other',
      metadata: {
        schemaVersion: 'insight/v1',
        generatedAt: '2026-05-07T12:00:00.000Z',
        sourceProvider: 'relayfile',
        sourcePaths: ['/insights/pr-123.json', '/insights/supporting.txt'],
        freshness: {
          ttlSeconds: 600,
          staleAt: '2026-05-07T12:10:00.000Z',
        },
      },
    });
    expect(block.content).toContain('"summary": "Insight summary."');
  });

  it('respects preview.maxChars when projecting content', () => {
    const block = projectInsightAsContextBlock({
      envelope: {
        schemaVersion: 'insight/v1',
        generatedAt: '2026-05-07T12:00:00.000Z',
        sourceProvider: 'relayfile',
        sourcePaths: ['/insights/preview.txt'],
        body: 'abcdefghijklmnopqrstuvwxyz',
      },
      preview: { maxChars: 10 },
    });

    expect(block.content).toBe('abcdefghij');
  });
});
