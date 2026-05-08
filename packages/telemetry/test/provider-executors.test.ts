import { describe, expect, it } from 'vitest';
import {
  buildHumanEvalOneShotPrompt,
  createAgentRelayHumanEvalExecutor,
  createOpenCodeHumanEvalExecutor,
} from '../src/evals/provider-executors.js';
import type { CliRunner } from '@agent-assistant/harness/worker-bridge';

describe('provider eval executors', () => {
  it('builds a one-shot prompt without exposing the human rubric', () => {
    const prompt = buildHumanEvalOneShotPrompt({
      id: 'smoke.case',
      suite: 'smoke',
      input: {
        message: 'Generate the thing.',
        systemPrompt: 'Use product conventions.',
        threadHistory: [{ role: 'user', content: 'prior' }],
      },
      expected: {
        must: ['Secret criterion'],
        mustNot: ['Secret anti-criterion'],
      },
    }, {
      productName: 'Ricky',
      instructions: ['Prefer concrete evidence.'],
    });

    expect(prompt).toContain('Ricky');
    expect(prompt).toContain('Use product conventions.');
    expect(prompt).toContain('Generate the thing.');
    expect(prompt).toContain('Prefer concrete evidence.');
    expect(prompt).not.toContain('Secret criterion');
    expect(prompt).not.toContain('Secret anti-criterion');
  });

  it('runs OpenCode-compatible CLI runners and normalizes output', async () => {
    let capturedModel: string | undefined;
    const runner: CliRunner = {
      id: 'opencode',
      async run(input) {
        capturedModel = input.model;
        return { status: 'completed', text: `answered: ${input.prompt}` };
      },
    };
    const executor = createOpenCodeHumanEvalExecutor({
      productName: 'Ricky',
      model: 'opencode/minimax-m2.5-free',
      runner,
    });

    const actual = await executor({
      id: 'smoke.opencode',
      suite: 'smoke',
      input: { message: 'hello' },
      expected: {},
    }, {
      providerMode: true,
      rootDir: '/tmp/project',
    });

    expect(capturedModel).toBe('opencode/minimax-m2.5-free');
    expect(actual).toMatchObject({
      ok: true,
      status: 'completed',
      model: 'opencode/minimax-m2.5-free',
      toolCalls: [],
    });
    expect(String((actual as { content?: unknown }).content)).toContain('hello');
  });

  it('uses an Agent Relay execution adapter for complex provider evals', async () => {
    const executor = createAgentRelayHumanEvalExecutor({
      productName: 'Ricky',
      adapter: {
        async execute(request) {
          expect(request.requirements?.toolUse).toBe('allowed');
          expect(request.instructions.systemPrompt).toContain('Use the broker.');
          return {
            backendId: 'agent-relay',
            status: 'completed',
            output: {
              text: 'relay answer',
              structured: {
                toolCalls: [{ name: 'workspace.read' }],
              },
            },
            metadata: {
              relay: {
                channelId: 'evals',
              },
            },
          };
        },
      },
    });

    const actual = await executor({
      id: 'smoke.relay',
      suite: 'smoke',
      input: { message: 'Use the broker.' },
      expected: {},
    }, {
      providerMode: true,
      rootDir: '/tmp/project',
    });

    expect(actual).toMatchObject({
      ok: true,
      status: 'completed',
      content: 'relay answer',
      toolCalls: [{ name: 'workspace.read' }],
      relay: { channelId: 'evals' },
    });
  });
});
