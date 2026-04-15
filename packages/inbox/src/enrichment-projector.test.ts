import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInboxEnrichmentProjector } from './enrichment-projector.js';
import type { InboxItem, InboxItemKind, InboxSourceTrust } from './types.js';

const FIXED_NOW = new Date('2026-04-15T12:00:00.000Z');

function makeItem(kind: InboxItemKind, trustLevel: InboxSourceTrust['trustLevel']): InboxItem {
  return {
    id: `${kind}-${trustLevel}`,
    assistantId: 'assistant-1',
    kind,
    status: 'pending',
    source: {
      sourceId: 'external-source',
      trustLevel,
    },
    title: `${kind} title`,
    content: `${kind} content`,
    receivedAt: '2026-04-15T11:45:00.000Z',
    updatedAt: '2026-04-15T11:45:00.000Z',
    scope: {
      threadId: 'thread-1',
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

describe('createInboxEnrichmentProjector', () => {
  it('projects imported_chat to external_snapshot with correct fields', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('imported_chat', 'verified'))).toEqual({
      id: 'inbox:imported_chat-verified',
      kind: 'external_snapshot',
      source: 'external-source',
      title: 'imported_chat title',
      content: 'imported_chat content',
      importance: 'high',
      confidence: 0.95,
      freshness: 'current',
      audience: 'assistant',
      metadata: {
        inbox: {
          kind: 'imported_chat',
          assistantId: 'assistant-1',
          trustLevel: 'verified',
          threadId: 'thread-1',
        },
      },
    });
  });

  it('projects forwarded_message to handoff kind', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('forwarded_message', 'trusted'))?.kind).toBe('handoff');
  });

  it('projects external_transcript to external_snapshot kind', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('external_transcript', 'trusted'))?.kind).toBe(
      'external_snapshot',
    );
  });

  it('projects trusted_memo to specialist_memo kind', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('trusted_memo', 'trusted'))?.kind).toBe('specialist_memo');
  });

  it('projects other to other kind', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('other', 'trusted'))?.kind).toBe('other');
  });

  it('maps verified trust to high importance and 0.95 confidence', () => {
    const projector = createInboxEnrichmentProjector();

    const candidate = projector.project(makeItem('trusted_memo', 'verified'));
    expect(candidate?.importance).toBe('high');
    expect(candidate?.confidence).toBe(0.95);
  });

  it('maps trusted trust to medium importance and 0.75 confidence', () => {
    const projector = createInboxEnrichmentProjector();

    const candidate = projector.project(makeItem('trusted_memo', 'trusted'));
    expect(candidate?.importance).toBe('medium');
    expect(candidate?.confidence).toBe(0.75);
  });

  it('maps unverified trust to low importance and 0.4 confidence', () => {
    const projector = createInboxEnrichmentProjector();

    const candidate = projector.project(makeItem('trusted_memo', 'unverified'));
    expect(candidate?.importance).toBe('low');
    expect(candidate?.confidence).toBe(0.4);
  });

  it('returns null for dismissed items', () => {
    const projector = createInboxEnrichmentProjector();
    const item = makeItem('imported_chat', 'verified');
    item.status = 'dismissed';

    expect(projector.project(item)).toBeNull();
  });

  it('returns null for expired items', () => {
    const projector = createInboxEnrichmentProjector();
    const item = makeItem('imported_chat', 'verified');
    item.status = 'expired';

    expect(projector.project(item)).toBeNull();
  });

  it('sets audience to assistant', () => {
    const projector = createInboxEnrichmentProjector();

    expect(projector.project(makeItem('imported_chat', 'verified'))?.audience).toBe('assistant');
  });
});
