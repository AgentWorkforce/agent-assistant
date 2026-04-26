import type { HarnessStopReason } from './types.js';

export interface StopReasonMessageOptions {
  /**
   * Whether the caller has a retry path queued (e.g. sage's harness→swarm
   * fallback). Affects retryable-stop-reason wording so the message tells
   * the user a retry is in progress rather than dead-ending them.
   */
  canRetry?: boolean;
}

/**
 * Maps a harness stop reason to a one-line, end-user-facing message.
 *
 * Returns a non-empty string for every documented `HarnessStopReason`,
 * plus a generic fallback for unknown / empty values. Use as the
 * user-visible reply when a turn ends without a usable assistant message
 * (outcome !== 'completed', or completed with empty text). Centralizing
 * the strings here keeps every consumer (sage's slack-runner, cloud's
 * specialist-worker fallback, CLI surfaces) speaking the same voice and
 * removes the silent-failure footgun where a consumer forgets to map a
 * stop reason and posts an empty reply.
 */
export function stopReasonToUserMessage(
  stopReason: HarnessStopReason | string | undefined,
  options: StopReasonMessageOptions = {},
): string {
  const canRetry = options.canRetry ?? false;
  switch (stopReason) {
    case 'answer_finalized':
      return "I don't have anything more to add.";
    case 'clarification_required':
      return "I need more details to answer that — could you clarify what you're looking for?";
    case 'approval_required':
      return "I need approval before I can finish that step.";
    case 'max_iterations_reached':
    case 'max_tool_calls_reached':
      return canRetry
        ? "I got stuck looping on tools and didn't reach an answer. Retrying with a simpler path."
        : "I got stuck looping on tools and didn't reach an answer. Try rephrasing or breaking the request into smaller pieces.";
    case 'redundant_tool_loop':
      return canRetry
        ? 'I got stuck in a loop on that tool call — let me retry with a different approach.'
        : 'I got stuck repeating the same tool call without making progress. Try rephrasing or asking about a more specific entity.';
    case 'timeout_reached':
      return canRetry
        ? "That took too long to gather. Retrying with a simpler path."
        : "That took too long to gather — try a narrower question.";
    case 'budget_reached':
      return "I hit this turn's budget before finishing. Try a narrower question.";
    case 'tool_unavailable':
      return "A tool I needed wasn't available, so I couldn't complete that. Try again in a moment.";
    case 'tool_error_unrecoverable':
      return "A tool I called failed unrecoverably. Try again in a moment.";
    case 'model_refused':
      return "I can't help with that request.";
    case 'model_invalid_response':
      return canRetry
        ? "I had trouble with my primary reply path. Retrying with a fallback."
        : "I had trouble producing a usable reply. Try rephrasing the request.";
    case 'runtime_error':
      return 'Something went wrong while processing that. Try again in a moment.';
    case 'cancelled':
      return 'Cancelled.';
    default:
      return "I couldn't complete that request.";
  }
}
