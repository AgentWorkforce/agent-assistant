import { describe, expect, it, vi } from 'vitest';

import type { MemoryStore } from '@agent-assistant/memory';
import { createMemoryTurnRetriever } from './memory-retriever.js';
import { createTurnContextAssembler } from './assembler.js';
import type { TurnContextInput } from './types.js';

function createInput(overrides: Partial<TurnContextInput> = {}): TurnContextInput {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    sessionId: 'session-1',
    userId: 'user-1',
    identity: {
      assistantName: 'Miya',
      baseInstructions: {
        systemPrompt: 'You are helpful.',
      },
    },
    ...overrides,
  };
}

describe('turn-context memory integration', () => {
  it('uses provided memory candidates without calling retriever', async () => {
    const retriever = { retrieve: vi.fn(async () => []) };
    const assembler = createTurnContextAssembler({ memoryRetriever: retriever });

    const result = await assembler.assemble(
      createInput({
        memory: {
          candidates: [
            {
              id: 'mem-1',
              text: 'User prefers concise replies.',
              scope: 'user',
              source: 'memory',
              relevance: 0.9,
            },
          ],
        },
      }),
    );

    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(result.provenance.usedMemoryIds).toEqual(['mem-1']);
    expect(result.context.blocks.some((block) => block.category === 'memory')).toBe(true);
  });

  it('calls retriever when memory candidates are absent', async () => {
    const retriever = {
      retrieve: vi.fn(async () => [
        {
          id: 'mem-2',
          text: 'Workspace uses pnpm.',
          scope: 'workspace' as const,
          source: 'memory-store',
          relevance: 0.7,
        },
      ]),
    };
    const assembler = createTurnContextAssembler({ memoryRetriever: retriever });

    const result = await assembler.assemble(createInput());

    expect(retriever.retrieve).toHaveBeenCalledOnce();
    expect(result.provenance.usedMemoryIds).toEqual(['mem-2']);
  });

  it('assembles without memory when no retriever exists', async () => {
    const assembler = createTurnContextAssembler();
    const result = await assembler.assemble(createInput());

    expect(result.provenance.usedMemoryIds).toEqual([]);
    expect(result.context.blocks.some((block) => block.category === 'memory')).toBe(false);
  });

  it('maps MemoryStore retrieval across session and user scopes', async () => {
    const retrieve = vi.fn<MemoryStore['retrieve']>(async (query) => {
      if (query.scope.kind === 'session') {
        return [
          {
            id: 'session-mem',
            scope: { kind: 'session', sessionId: 'session-1' },
            content: 'Asked about the SDK facade last turn.',
            tags: ['conversation'],
            createdAt: '2026-04-14T09:00:00.000Z',
            updatedAt: '2026-04-14T09:00:00.000Z',
            metadata: { source: 'session-memory' },
          },
        ];
      }

      return [
        {
          id: 'user-mem',
          scope: { kind: 'user', userId: 'user-1' },
          content: 'Prefers direct answers.',
          tags: ['preference'],
          createdAt: '2026-04-14T10:00:00.000Z',
          updatedAt: '2026-04-14T10:00:00.000Z',
          metadata: { source: 'user-memory' },
        },
      ];
    });

    const store = {
      retrieve,
    } as unknown as MemoryStore;

    const retriever = createMemoryTurnRetriever({
      store,
      includeSessionScope: true,
      includeUserScope: true,
    });

    const candidates = await retriever.retrieve({
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(candidates.map((candidate) => candidate.id)).toEqual(['user-mem', 'session-mem']);
    expect(candidates[0]?.metadata?.source).toBe('user-memory');
  });

  it('can include workspace scope through a resolver', async () => {
    const retrieve = vi.fn<MemoryStore['retrieve']>(async (query) => [
      {
        id: `${query.scope.kind}-mem`,
        scope: query.scope,
        content: `${query.scope.kind} memory`,
        tags: [],
        createdAt: '2026-04-14T10:00:00.000Z',
        updatedAt: '2026-04-14T10:00:00.000Z',
        metadata: { source: `${query.scope.kind}-memory` },
      },
    ]);

    const store = { retrieve } as unknown as MemoryStore;
    const retriever = createMemoryTurnRetriever({
      store,
      includeWorkspaceScope: true,
      workspaceIdResolver: () => 'workspace-1',
    });

    const candidates = await retriever.retrieve({
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(candidates.some((candidate) => candidate.scope === 'workspace')).toBe(true);
  });
});
