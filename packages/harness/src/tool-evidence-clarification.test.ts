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

  it('returns null for a failed tool result regardless of exclusion list (failed-tool short-circuit)', () => {
    // Failed tool results never feed the implicit clarification classifier.
    // The right action for a failed tool is to surface the failure or retry
    // — not ask the user a clarifying question. See the failed-tool
    // short-circuit in detectToolEvidenceClarification.
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

    expect(detectToolEvidenceClarification(result)).toBeNull();
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

  it('skips clarification when a single failed tool result has empty-looking output', () => {
    // Reproduces the prod-trace defect: github_specialist timed out and
    // returned an effectively-empty result. The hook used to misclassify
    // this as "needs clarification" — that's the bug Fix 1 closes.
    const failedResult = makeToolResult({
      toolName: 'github_specialist',
      status: 'error',
      structuredOutput: { entries: [] },
      error: {
        code: 'delegation_failed',
        message: 'The operation was aborted due to timeout',
        retryable: true,
      },
    });

    expect(detectToolEvidenceClarification(failedResult)).toBeNull();
  });

  it('skips clarification when the most recent of multiple results has failed', () => {
    // Sage's harness loop passes each tool result to the hook in turn, so
    // "last of multiple tools failed" is the relevant case to assert. We
    // only need to verify that the hook short-circuits on the failed
    // result — earlier successful results are evaluated separately.
    const lastFailed = makeToolResult({
      toolName: 'github_specialist',
      status: 'error',
      output: '',
      structuredOutput: { entries: [] },
      error: {
        code: 'provider_timeout',
        message: 'specialist timed out',
        retryable: true,
      },
    });

    expect(detectToolEvidenceClarification(lastFailed)).toBeNull();
  });

  it('still honors explicit clarification hints on a failed tool result', () => {
    // The failed-tool short-circuit only suppresses the implicit
    // classifier path. Explicit hints (set deliberately by the tool
    // author) still pass through.
    const result = makeToolResult({
      status: 'error',
      metadata: { clarification: { question: 'Which org should I use?' } },
      error: { code: 'auth_failed', message: 'no token' },
    });

    expect(detectToolEvidenceClarification(result)).toEqual({
      question: 'Which org should I use?',
      reason: 'custom',
      metadata: { toolName: 'memory_recall' },
    });
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
