import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createRuntimePolicy, type HarnessToolResult } from './runtime-policy/index.js';

function makeCall(
  name: string,
  input: Record<string, unknown> = {},
  id = `${name}-call`,
) {
  return { id, name, input };
}

describe('createRuntimePolicy', () => {
  it('defaults to a no-op policy', () => {
    const policy = createRuntimePolicy();
    const decision = policy.beforeToolCall({
      turnId: 'turn-1',
      call: makeCall('lookup', { q: 'alpha' }),
      tool: { name: 'lookup', description: 'Lookup' },
      toolCallCount: 0,
      maxToolCalls: 8,
    });

    expect(decision).toEqual({ action: 'allow', consumeToolCall: true });
    expect(
      policy.sanitizeFinalOutput({
        turnId: 'turn-1',
        text: 'plain final answer',
      }),
    ).toMatchObject({
      text: 'plain final answer',
      sanitized: false,
      strippedTokenClasses: [],
      events: [],
    });
  });

  it('returns cached results without consuming logical budget', () => {
    const policy = createRuntimePolicy({
      toolResultCache: { enabled: true },
    });
    const call = makeCall('workspace_list', { path: '/repo', depth: 2 });
    const result: HarnessToolResult = {
      callId: call.id,
      toolName: call.name,
      status: 'success',
      output: '["package.json"]',
    };

    expect(
      policy.beforeToolCall({
        turnId: 'turn-1',
        call,
        tool: { name: call.name, description: 'List workspace' },
        toolCallCount: 0,
        maxToolCalls: 8,
      }),
    ).toMatchObject({ action: 'allow', consumeToolCall: true });

    policy.afterToolResult({
      turnId: 'turn-1',
      call,
      tool: { name: call.name, description: 'List workspace' },
      result,
    });

    const duplicate = policy.beforeToolCall({
      turnId: 'turn-1',
      call: makeCall('workspace_list', { depth: 2, path: '/repo' }, 'dup-call'),
      tool: { name: call.name, description: 'List workspace' },
      toolCallCount: 1,
      maxToolCalls: 8,
    });

    expect(duplicate).toMatchObject({
      action: 'cached',
      consumeToolCall: false,
      result: {
        callId: 'dup-call',
        toolName: 'workspace_list',
        output: '["package.json"]',
        metadata: {
          runtimePolicy: {
            synthetic: true,
            cacheHit: true,
          },
        },
      },
      events: [
        expect.objectContaining({
          kind: 'runtime_policy.cache_hit',
          reason: 'duplicate_tool_call_cached',
        }),
      ],
    });
  });

  it('blocks repeated broad listing until the model drills into a candidate', () => {
    const policy = createRuntimePolicy({
      drillOrStop: {
        candidateProducingTools: ['repo_list'],
        broadTools: ['repo_list'],
      },
    });

    policy.afterToolResult({
      turnId: 'turn-1',
      call: makeCall('repo_list', { path: '/repo' }),
      tool: { name: 'repo_list', description: 'List repo', metadata: { runtimePolicyCategories: ['broad'] } },
      result: {
        callId: 'list-1',
        toolName: 'repo_list',
        status: 'success',
        structuredOutput: {
          candidates: [{ path: 'package.json' }, { path: 'src/index.ts' }],
        },
      },
    });

    const blocked = policy.beforeToolCall({
      turnId: 'turn-1',
      call: makeCall('repo_list', { path: '/repo' }, 'list-2'),
      tool: { name: 'repo_list', description: 'List repo', metadata: { runtimePolicyCategories: ['broad'] } },
      toolCallCount: 1,
      maxToolCalls: 8,
    });
    expect(blocked).toMatchObject({
      action: 'blocked',
      consumeToolCall: false,
      events: [
        expect.objectContaining({
          kind: 'runtime_policy.blocked',
          reason: 'drill_or_stop_required',
        }),
      ],
    });

    const drilled = policy.beforeToolCall({
      turnId: 'turn-1',
      call: makeCall('repo_read', { path: 'package.json' }, 'read-1'),
      tool: { name: 'repo_read', description: 'Read repo file' },
      toolCallCount: 1,
      maxToolCalls: 8,
    });
    expect(drilled).toEqual({ action: 'allow', consumeToolCall: true });
  });

  it('strips nested pseudo-tool XML and fenced pseudo-tool payloads', () => {
    const policy = createRuntimePolicy({
      outputSanitizer: { enabled: true },
    });

    const sanitized = policy.sanitizeFinalOutput({
      turnId: 'turn-1',
      modelId: 'model-1',
      text: [
        'Before',
        '<function_calls><invoke name="workspace_list"><parameter name="path">/repo</parameter></invoke></function_calls>',
        '```xml',
        '<invoke name="workspace_read"><parameter name="path">package.json</parameter></invoke>',
        '```',
        'After',
      ].join('\n'),
    });

    expect(sanitized.text).toBe('Before\n\nAfter');
    expect(sanitized.sanitized).toBe(true);
    expect(sanitized.strippedTokenClasses).toEqual(
      expect.arrayContaining(['function_calls', 'invoke', 'parameter', 'pseudo_tool_fence']),
    );
    expect(sanitized.events).toEqual([
      expect.objectContaining({
        kind: 'runtime_policy.output_sanitized',
        reason: 'pseudo_tool_syntax_removed',
        metadata: expect.objectContaining({
          modelId: 'model-1',
        }),
      }),
    ]);
  });

  it('supports a generic custom guard hook for future deep-repo funnel rules', () => {
    const policy = createRuntimePolicy({
      customGuards: [
        {
          name: 'deep_repo_funnel',
          evaluate(input) {
            if (input.call.name !== 'repo_traverse') return null;
            return {
              advisory: 'Use the repo architecture summary first, then drill into one or two files.',
              reason: 'deep_repo_funnel',
              metadata: { repo: 'AgentWorkforce/relaycast' },
            };
          },
        },
      ],
    });

    const decision = policy.beforeToolCall({
      turnId: 'turn-1',
      call: makeCall('repo_traverse', { repo: 'AgentWorkforce/relaycast', recursive: true }),
      tool: { name: 'repo_traverse', description: 'Traverse repo' },
      toolCallCount: 0,
      maxToolCalls: 8,
    });

    expect(decision).toMatchObject({
      action: 'blocked',
      consumeToolCall: false,
      result: {
        output: 'Use the repo architecture summary first, then drill into one or two files.',
      },
      events: [
        expect.objectContaining({
          kind: 'runtime_policy.blocked',
          reason: 'deep_repo_funnel',
          metadata: expect.objectContaining({
            repo: 'AgentWorkforce/relaycast',
          }),
        }),
      ],
    });
  });

  it('does not capture bare fetch in runtime-policy modules', () => {
    const runtimePolicySource = readFileSync(
      resolve(fileURLToPath(new URL('runtime-policy', import.meta.url)), 'index.ts'),
      'utf8',
    );

    expect(runtimePolicySource).not.toMatch(/=\s*fetch\b/u);
    expect(runtimePolicySource).not.toMatch(/\?\?\s*fetch\b/u);
  });
});
