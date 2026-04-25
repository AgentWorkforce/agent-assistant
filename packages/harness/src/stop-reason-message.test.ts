import { describe, expect, it } from 'vitest';

import { stopReasonToUserMessage } from './stop-reason-message.js';
import type { HarnessStopReason } from './types.js';

const ALL_STOP_REASONS: HarnessStopReason[] = [
  'answer_finalized',
  'clarification_required',
  'approval_required',
  'max_iterations_reached',
  'max_tool_calls_reached',
  'timeout_reached',
  'budget_reached',
  'tool_unavailable',
  'tool_error_unrecoverable',
  'model_refused',
  'model_invalid_response',
  'runtime_error',
  'cancelled',
];

describe('stopReasonToUserMessage', () => {
  it('returns a non-empty string for every documented stop reason', () => {
    for (const reason of ALL_STOP_REASONS) {
      const message = stopReasonToUserMessage(reason);
      expect(message, `stop reason: ${reason}`).toBeTruthy();
      expect(message.length, `stop reason: ${reason}`).toBeGreaterThan(0);
    }
  });

  it('returns a non-empty fallback for undefined, empty, or unknown stop reasons', () => {
    expect(stopReasonToUserMessage(undefined)).toBeTruthy();
    expect(stopReasonToUserMessage('')).toBeTruthy();
    expect(stopReasonToUserMessage('something_we_did_not_define_yet')).toBeTruthy();
  });

  it('mentions a retry when canRetry is true for retryable stop reasons', () => {
    const retryable: HarnessStopReason[] = [
      'max_iterations_reached',
      'max_tool_calls_reached',
      'timeout_reached',
      'model_invalid_response',
    ];
    for (const reason of retryable) {
      const message = stopReasonToUserMessage(reason, { canRetry: true });
      expect(message.toLowerCase(), `retryable reason: ${reason}`).toContain('retry');
    }
  });

  it('does not promise a retry when canRetry is omitted or false', () => {
    const message = stopReasonToUserMessage('max_iterations_reached');
    expect(message.toLowerCase()).not.toContain('retrying');
    const messageFalse = stopReasonToUserMessage('max_iterations_reached', { canRetry: false });
    expect(messageFalse.toLowerCase()).not.toContain('retrying');
  });

  it('uses distinct, meaningful copy for each documented reason', () => {
    const messages = new Set(ALL_STOP_REASONS.map((reason) => stopReasonToUserMessage(reason)));
    // We deliberately collapse max_iterations_reached + max_tool_calls_reached
    // onto the same copy (same UX), so allow up to one collision.
    expect(messages.size).toBeGreaterThanOrEqual(ALL_STOP_REASONS.length - 1);
  });

  it('asks for clarification on clarification_required', () => {
    expect(stopReasonToUserMessage('clarification_required').toLowerCase()).toContain('clarif');
  });

  it('signals refusal on model_refused', () => {
    expect(stopReasonToUserMessage('model_refused').toLowerCase()).toContain("can't help");
  });

  it('signals cancellation on cancelled', () => {
    expect(stopReasonToUserMessage('cancelled').toLowerCase()).toContain('cancel');
  });
});
