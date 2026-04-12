/**
 * Minimal integration helpers for translating proactive engine outputs into
 * policy engine inputs.
 *
 * These helpers are intentionally thin — they encode only the field-mapping
 * rules defined in the v1 integration contract. All orchestration (calling
 * evaluate, acting on the result, managing state) remains in product code.
 *
 * Neither package is imported by the other. This file is the only place where
 * both type namespaces coexist, and it stays out of both package trees.
 *
 * See: docs/architecture/v1-proactive-policy-integration-contract.md §2
 */

import type { FollowUpDecision, WatchTrigger } from '../../proactive/src/index.js';
import type { Action } from '../../policy/src/index.js';

/**
 * Build a policy Action from a proactive FollowUpDecision whose action === 'fire'.
 *
 * @param decision  - The FollowUpDecision returned by proactiveEngine.evaluateFollowUp().
 * @param userId    - The user ID resolved from the session by the caller (product-owned).
 * @param id        - A caller-supplied unique ID for this action attempt.
 */
export function followUpToAction(
  decision: FollowUpDecision,
  userId: string,
  id: string,
): Action {
  return {
    id,
    type: 'proactive_follow_up',
    description:
      decision.messageTemplate ?? `Proactive follow-up from rule ${decision.ruleId}`,
    sessionId: decision.sessionId,
    userId,
    proactive: true,
    metadata: {
      sourceRuleId: decision.ruleId,
      routingHint: decision.routingHint,
    },
  };
}

/**
 * Build a policy Action from a proactive WatchTrigger.
 *
 * @param trigger   - The WatchTrigger returned by proactiveEngine.evaluateWatchRules().
 * @param sessionId - The session context resolved by the caller (watch triggers may be cross-session).
 * @param userId    - The user ID resolved from the session by the caller.
 * @param id        - A caller-supplied unique ID for this action attempt.
 */
export function watchTriggerToAction(
  trigger: WatchTrigger,
  sessionId: string,
  userId: string,
  id: string,
): Action {
  return {
    id,
    type: `proactive_watch_${trigger.action.type}`,
    description: `Watch rule ${trigger.ruleId} triggered: ${trigger.action.type}`,
    sessionId,
    userId,
    proactive: true,
    metadata: {
      sourceRuleId: trigger.ruleId,
      watchAction: trigger.action,
      triggeredAt: trigger.triggeredAt,
    },
  };
}
