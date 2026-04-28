import { describe, expect, it } from 'vitest';

import { detectToolEvidenceClarification } from './tool-evidence-clarification.js';
import type { HarnessToolResult } from './types.js';

function makeToolResult(overrides: Partial<HarnessToolResult>): HarnessToolResult {
  return {
    callId: 'call-1',
    toolName: 'memory_recall',
    status: 'success',
    ...overrides,
  };
}

describe('detectToolEvidenceClarification', () => {
  it('returns null for an empty-result signal on an excluded tool, but still classifies without exclusions', () => {
    const result = makeToolResult({
      structuredOutput: { results: [] },
    });

    expect(
      detectToolEvidenceClarification(result, { excludeToolNames: ['memory_recall'] }),
    ).toBeNull();

    const clarification = detectToolEvidenceClarification(result);
    expect(clarification).not.toBeNull();
    expect(clarification?.reason).toBe('empty_results');
  });

  it('returns null for a transient error on an excluded tool, but still classifies without exclusions', () => {
    const result = makeToolResult({
      status: 'error',
      error: {
        code: 'rate_limited',
        message: 'Provider rate limited the request.',
      },
    });

    expect(
      detectToolEvidenceClarification(result, { excludeToolNames: ['memory_recall'] }),
    ).toBeNull();

    const clarification = detectToolEvidenceClarification(result);
    expect(clarification).not.toBeNull();
    expect(clarification?.reason).toBe('transient_provider_error');
  });

  it('returns null for ambiguous evidence on an excluded tool', () => {
    const result = makeToolResult({
      structuredOutput: { ambiguous: true },
    });

    expect(
      detectToolEvidenceClarification(result, { excludeToolNames: ['memory_recall'] }),
    ).toBeNull();

    const clarification = detectToolEvidenceClarification(result);
    expect(clarification).not.toBeNull();
    expect(clarification?.reason).toBe('ambiguous_identifier');
  });

  it('still returns explicit clarification hints even when the tool is excluded', () => {
    const result = makeToolResult({
      metadata: {
        clarification: {
          question: 'Which scope?',
        },
      },
      structuredOutput: { results: [] },
    });

    const clarification = detectToolEvidenceClarification(result, {
      excludeToolNames: ['memory_recall'],
    });

    expect(clarification).toEqual({
      question: 'Which scope?',
      reason: 'custom',
      metadata: { toolName: 'memory_recall' },
    });
  });

  it('supports multiple excluded tool names', () => {
    const excluded = ['memory_recall', 'workspace_search'] as const;

    const memoryResult = makeToolResult({
      structuredOutput: { results: [] },
    });
    const workspaceResult = makeToolResult({
      toolName: 'workspace_search',
      structuredOutput: { ambiguous: true },
    });

    expect(detectToolEvidenceClarification(memoryResult, { excludeToolNames: excluded })).toBeNull();
    expect(
      detectToolEvidenceClarification(workspaceResult, { excludeToolNames: excluded }),
    ).toBeNull();
  });

  it('treats empty or undefined excludeToolNames as no behavior change', () => {
    const result = makeToolResult({
      structuredOutput: { results: [] },
    });

    const baseline = detectToolEvidenceClarification(result, {});
    const undefinedOption = detectToolEvidenceClarification(result, {
      excludeToolNames: undefined,
    });
    const emptyOption = detectToolEvidenceClarification(result, {
      excludeToolNames: [],
    });

    expect(baseline?.reason).toBe('empty_results');
    expect(undefinedOption).toEqual(baseline);
    expect(emptyOption).toEqual(baseline);
  });
});
