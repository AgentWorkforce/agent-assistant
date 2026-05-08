import { describe, expect, it } from 'vitest';

import {
  runEvalSuite,
  type EvalCase,
  type EvalTurnRunner,
} from '../src/evals/index.js';

function createSyntheticRunner(): EvalTurnRunner {
  return async ({ fixture }) => {
    const providerText = fixture.providerResponses.map((response) => response.outputText).join(' ');
    const toolText = fixture.tools
      .map((tool) => `${tool.name}: ${tool.outputText}`)
      .join(' ');

    return {
      finalOutput: [providerText, toolText].filter((part) => part.length > 0).join(' ').trim(),
    };
  };
}

function createCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    name: overrides.name ?? 'synthetic-happy-path',
    fixture: overrides.fixture ?? {
      providerResponses: [
        {
          outputText: 'Final answer cites package.json and src/index.ts.',
          latencyMs: 12,
          cost: 0.3,
        },
      ],
      tools: [
        {
          name: 'workspace_read',
          outputText: 'package.json',
          latencyMs: 8,
          cost: 0.1,
        },
        {
          name: 'workspace_read',
          outputText: 'src/index.ts',
          latencyMs: 10,
          cost: 0.1,
        },
      ],
    },
    checks: overrides.checks ?? {
      requiredEvidence: ['package.json', '/src\\/index\\.ts/u'],
      forbiddenFanout: [{ toolName: 'workspace_read', max: 2 }],
      budget: { maxToolCalls: 3, maxLatencyMs: 50 },
      finalOutputClean: true,
    },
  };
}

describe('runEvalSuite', () => {
  it('passes for a synthetic happy path and derives budget totals from fixtures', async () => {
    const [result] = await runEvalSuite([createCase()], createSyntheticRunner());

    expect(result).toEqual({
      name: 'synthetic-happy-path',
      passed: true,
      score: {
        components: {
          requiredEvidence: 1,
          forbiddenFanout: 1,
          budget: 1,
          finalOutputClean: 1,
        },
        total: 1,
      },
      evidence: {
        matched: ['/src\\/index\\.ts/u', 'package.json'],
        missing: [],
      },
      forbiddenFanoutViolations: [],
      budget: {
        toolCalls: 2,
        latencyMs: 30,
        cost: 0.5,
      },
      finalOutputCleanResult: {
        clean: true,
        sanitizedKinds: [],
      },
    });
  });

  it('fails on missing required evidence', async () => {
    const [result] = await runEvalSuite(
      [
        createCase({
          name: 'missing-evidence',
          checks: {
            requiredEvidence: ['docs/architecture.md'],
            finalOutputClean: true,
          },
        }),
      ],
      createSyntheticRunner(),
    );

    expect(result.passed).toBe(false);
    expect(result.evidence).toEqual({
      matched: [],
      missing: ['docs/architecture.md'],
    });
    expect(result.score.components.requiredEvidence).toBe(0);
  });

  it('fails on fanout overshoot', async () => {
    const [result] = await runEvalSuite(
      [
        createCase({
          name: 'fanout-overshoot',
          checks: {
            forbiddenFanout: [{ toolName: 'workspace_read', max: 1 }],
          },
        }),
      ],
      createSyntheticRunner(),
    );

    expect(result.passed).toBe(false);
    expect(result.forbiddenFanoutViolations).toEqual([
      'workspace_read called 2 times (max 1)',
    ]);
    expect(result.score.components.forbiddenFanout).toBe(0);
  });

  it('fails on budget exceed', async () => {
    const [result] = await runEvalSuite(
      [
        createCase({
          name: 'budget-exceed',
          checks: {
            budget: { maxToolCalls: 1, maxLatencyMs: 20 },
          },
        }),
      ],
      createSyntheticRunner(),
    );

    expect(result.passed).toBe(false);
    expect(result.budget).toEqual({
      toolCalls: 2,
      latencyMs: 30,
      cost: 0.5,
    });
    expect(result.score.components.budget).toBe(0);
  });

  it('marks dirty output when the sanitizer fires', async () => {
    const dirtyRunner: EvalTurnRunner = async ({ fixture }) => {
      const providerText = fixture.providerResponses.map((response) => response.outputText).join(' ');
      return {
        finalOutput: providerText,
        sanitizedKinds: ['pseudo_tool_fence', 'invoke'],
      };
    };

    const [result] = await runEvalSuite(
      [
        createCase({
          name: 'dirty-output',
          checks: {
            finalOutputClean: true,
          },
        }),
      ],
      dirtyRunner,
    );

    expect(result.passed).toBe(false);
    expect(result.finalOutputCleanResult).toEqual({
      clean: false,
      sanitizedKinds: ['invoke', 'pseudo_tool_fence'],
    });
    expect(result.score.components.finalOutputClean).toBe(0);
  });

  it('returns results in deterministic name order', async () => {
    const results = await runEvalSuite(
      [createCase({ name: 'zeta' }), createCase({ name: 'alpha' })],
      createSyntheticRunner(),
    );

    expect(results.map((result) => result.name)).toEqual(['alpha', 'zeta']);
  });
});
