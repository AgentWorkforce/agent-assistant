import { describe, expect, it } from 'vitest';

import { createTurnContextAssembler } from './assembler.js';
import { toExecutionRequest } from './projection.js';

describe('toExecutionRequest', () => {
  it('projects turn-context assembly into the canonical ExecutionRequest shape', async () => {
    const assembler = createTurnContextAssembler();
    const assembly = await assembler.assemble({
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      userId: 'user-1',
      threadId: 'thread-1',
      identity: {
        assistantName: 'Sage',
        baseInstructions: {
          systemPrompt: 'You are Sage.',
          developerPrompt: 'Preserve product identity.',
        },
      },
      shaping: {
        mode: 'founder-advisory',
        instructionOverlays: [
          {
            id: 'overlay-1',
            source: 'triage',
            text: 'Focus on delivery risk.',
            priority: 'high',
          },
        ],
        responseStyle: {
          preferMarkdown: true,
          maxAnswerChars: 1200,
        },
      },
      memory: {
        candidates: [
          {
            id: 'mem-1',
            text: 'Founder prefers concise risk calls.',
            scope: 'user',
            source: 'memory',
            relevance: 0.9,
          },
        ],
      },
      enrichment: {
        candidates: [
          {
            id: 'enrich-1',
            kind: 'workspace_state',
            source: 'reviewer',
            title: 'Review Signal',
            content: 'The implementation plan is ready.',
            importance: 'high',
          },
        ],
      },
      guardrails: {
        overlays: [
          {
            id: 'guardrail-1',
            source: 'policy',
            rule: 'Do not claim unverified test results.',
            priority: 'high',
          },
        ],
      },
      metadata: {
        assemblySource: 'test',
        owner: 'assembly',
      },
    });

    const request = toExecutionRequest(
      assembly,
      {
        id: 'msg-1',
        text: 'What is left for local BYOH?',
        receivedAt: '2026-04-20T12:00:00.000Z',
        attachments: [
          {
            id: 'att-1',
            type: 'text/markdown',
            name: 'plan.md',
          },
        ],
      },
      {
        tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
        requirements: { toolUse: 'allowed', traceDepth: 'standard' },
        continuation: {
          continuationId: 'cont-1',
          kind: 'deferred',
          state: { cursor: 'abc' },
        },
        metadata: {
          owner: 'override',
          triage: { route: 'local-byoh' },
        },
      },
    );

    expect(request).toMatchObject({
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      userId: 'user-1',
      threadId: 'thread-1',
      message: {
        id: 'msg-1',
        text: 'What is left for local BYOH?',
        receivedAt: '2026-04-20T12:00:00.000Z',
        attachments: [{ id: 'att-1', type: 'text/markdown', name: 'plan.md' }],
      },
      tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
      requirements: { toolUse: 'allowed', traceDepth: 'standard' },
      continuation: {
        continuationId: 'cont-1',
        kind: 'deferred',
        state: { cursor: 'abc' },
      },
      metadata: {
        assemblySource: 'test',
        owner: 'override',
        triage: { route: 'local-byoh' },
      },
    });

    for (const segment of assembly.instructions.systemSegments) {
      expect(request.instructions.systemPrompt).toContain(segment.text);
    }
    for (const segment of [
      ...assembly.instructions.developerSegments,
      ...assembly.instructions.guardrailSegments,
    ]) {
      expect(request.instructions.developerPrompt).toContain(segment.text);
    }
    expect(request.instructions.responseStyle).toEqual({
      preferMarkdown: true,
      maxAnswerChars: 1200,
    });

    expect(request.context?.blocks).toHaveLength(2);
    expect(request.context?.blocks[0]).toMatchObject({
      id: assembly.context.blocks[0]?.id,
      label: assembly.context.blocks[0]?.label,
      text: assembly.context.blocks[0]?.content,
      category: assembly.context.blocks[0]?.category,
    });
    expect(request.context?.blocks[1]).toMatchObject({
      id: assembly.context.blocks[1]?.id,
      label: assembly.context.blocks[1]?.label,
      text: assembly.context.blocks[1]?.content,
      category: assembly.context.blocks[1]?.category,
    });
  });

  it('maps session context blocks to ExecutionRequest other blocks with source metadata', async () => {
    const assembler = createTurnContextAssembler();
    const assembly = await assembler.assemble({
      assistantId: 'assistant-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      identity: {
        baseInstructions: {
          systemPrompt: 'You are Sage.',
        },
      },
      session: {
        state: 'active',
        summary: 'Discussing local BYOH.',
      },
    });

    const request = toExecutionRequest(assembly, {
      id: 'msg-1',
      text: 'Continue.',
      receivedAt: '2026-04-20T12:00:00.000Z',
    });

    expect(request.context?.blocks[0]).toMatchObject({
      label: 'Session Context',
      text: 'State: active\nSummary: Discussing local BYOH.',
      category: 'other',
      metadata: {
        source: 'session',
        turnContextCategory: 'session',
      },
    });
  });
});
