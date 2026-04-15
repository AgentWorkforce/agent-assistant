import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInboxMemoryProjector } from './memory-projector.js';
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
    content: `${kind} content`,
    receivedAt: '2026-04-15T11:45:00.000Z',
    updatedAt: '2026-04-15T11:45:00.000Z',
    scope: {
      userId: 'user-1',
      threadId: 'thread-1',
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

describe('createInboxMemoryProjector', () => {
  it('projects imported_chat with verified trust', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('imported_chat', 'verified'))).toEqual({
      id: 'inbox:imported_chat-verified',
      text: 'imported_chat content',
      scope: 'user',
      source: 'external-source',
      relevance: 0.9,
      freshness: 'current',
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

  it('projects trusted_memo with trusted trust level', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('trusted_memo', 'trusted'))?.relevance).toBe(0.7);
  });

  it('projects forwarded_message with unverified trust level', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('forwarded_message', 'unverified'))?.relevance).toBe(0.4);
  });

  it('covers external_transcript items', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('external_transcript', 'trusted'))?.id).toBe(
      'inbox:external_transcript-trusted',
    );
  });

  it('covers other items', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('other', 'trusted'))?.id).toBe('inbox:other-trusted');
  });

  it('returns null for dismissed items', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('imported_chat', 'verified');
    item.status = 'dismissed';

    expect(projector.project(item)).toBeNull();
  });

  it('returns null for expired items', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('imported_chat', 'verified');
    item.status = 'expired';

    expect(projector.project(item)).toBeNull();
  });

  it('maps scope to user when userId is present', () => {
    const projector = createInboxMemoryProjector();

    expect(projector.project(makeItem('imported_chat', 'verified'))?.scope).toBe('user');
  });

  it('maps scope to session when only sessionId is present', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('imported_chat', 'verified');
    item.scope = { sessionId: 'session-1' };

    expect(projector.project(item)?.scope).toBe('session');
  });

  it('maps scope to workspace when only workspaceId is present', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('imported_chat', 'verified');
    item.scope = { workspaceId: 'workspace-1' };

    expect(projector.project(item)?.scope).toBe('workspace');
  });

  it('marks items under one hour old as current', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('trusted_memo', 'trusted');
    item.receivedAt = '2026-04-15T11:30:00.000Z';

    expect(projector.project(item)?.freshness).toBe('current');
  });

  it('marks items between one hour and one day old as recent', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('trusted_memo', 'trusted');
    item.receivedAt = '2026-04-15T02:00:00.000Z';

    expect(projector.project(item)?.freshness).toBe('recent');
  });

  it('marks items older than one day as stale', () => {
    const projector = createInboxMemoryProjector();
    const item = makeItem('trusted_memo', 'trusted');
    item.receivedAt = '2026-04-13T11:00:00.000Z';

    expect(projector.project(item)?.freshness).toBe('stale');
  });
});
