/**
 * Shared fail-open posting verification policy.
 *
 * Extracted from sage's `src/proactive/verification-policy.ts` (PR #186) so
 * every AA consumer that posts proactively can apply the same policy
 * without duplicating the discriminated outcome shape, the env reader, the
 * `[unverified]` prefix string, or the post/block decision tree.
 *
 * The policy:
 *   - "verified"               → post normally, with the verified text + evidence.
 *   - "no_supporting_evidence" → block. The specialist responded but found
 *     nothing that backs the claim; posting an unsubstantiated specific
 *     claim is worse than silence here. Same under fail-open.
 *   - "bridge_unavailable" / "verification_degraded":
 *       fail-open default → post with `[unverified] ` prefix
 *       fail-open=false   → block
 *
 * The kill-switch env var is `AA_PROACTIVE_FAIL_OPEN_VERIFICATION`. The
 * legacy sage-prefixed name `SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION` is
 * read as a deprecation alias so the rename can land without flipping
 * prod behavior on the dependency bump. After sage drops the alias from
 * its own code (one minor cycle), the legacy read can be removed here too.
 */

export const UNVERIFIED_PREFIX = '[unverified] ';

export type VerifyDraftOutcome<E = unknown> =
  | { kind: 'verified'; text: string; evidence: E[] }
  | { kind: 'bridge_unavailable'; draftedText: string }
  | { kind: 'verification_degraded'; draftedText: string; reason: string }
  | { kind: 'no_supporting_evidence' };

export type PolicyDecision<E = unknown> =
  | { action: 'post'; text: string; evidence: E[] }
  | { action: 'post_unverified'; text: string; reason: string }
  | { action: 'block'; reason: string };

export interface PolicyEnv {
  failOpen: boolean;
}

/**
 * Read the fail-open kill switch. Default is fail-open. Operator can flip
 * `AA_PROACTIVE_FAIL_OPEN_VERIFICATION=false` (or the legacy
 * `SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION=false` for one deprecation cycle)
 * to restore strict-block behavior in an emergency.
 *
 * Either kill switch wins — i.e. setting EITHER to "false" disables
 * fail-open. This is intentionally conservative: an operator running the
 * legacy env var to intentionally fail-closed during an incident must not
 * silently start failing-open after the migration.
 */
export function readFailOpenFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['AA_PROACTIVE_FAIL_OPEN_VERIFICATION'] === 'false') return false;
  if (env['SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION'] === 'false') return false;
  return true;
}

export function applyUnverifiedPrefix(text: string): string {
  return text.startsWith(UNVERIFIED_PREFIX) ? text : `${UNVERIFIED_PREFIX}${text}`;
}

export function decidePostingPolicy<E>(
  outcome: VerifyDraftOutcome<E>,
  env: PolicyEnv,
): PolicyDecision<E> {
  switch (outcome.kind) {
    case 'verified':
      return { action: 'post', text: outcome.text, evidence: outcome.evidence };
    case 'no_supporting_evidence':
      return { action: 'block', reason: 'no_supporting_evidence' };
    case 'bridge_unavailable':
      if (env.failOpen) {
        return {
          action: 'post_unverified',
          text: applyUnverifiedPrefix(outcome.draftedText),
          reason: 'bridge_unavailable',
        };
      }
      return { action: 'block', reason: 'verification_unavailable' };
    case 'verification_degraded':
      if (env.failOpen) {
        return {
          action: 'post_unverified',
          text: applyUnverifiedPrefix(outcome.draftedText),
          reason: outcome.reason,
        };
      }
      return { action: 'block', reason: outcome.reason };
  }
}
