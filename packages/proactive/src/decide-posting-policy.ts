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
 * Plain map of env var names to their values. Avoids `NodeJS.ProcessEnv` in
 * the public API so this package stays usable from non-Node runtimes
 * (Cloudflare Workers without `nodejs_compat`, browsers, Deno, etc.) — the
 * `NodeJS` global type isn't available there and the emitted `.d.ts` would
 * fail to load. Callers that DO have a Node `process.env` can pass it
 * directly; the runtime structural shape matches.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Best-effort read of the host `process.env` without dragging Node typings
 * into the public surface. Returns `{}` on hosts where `process` is
 * undefined (pure Workers, browsers) instead of throwing — the caller's
 * intent in not passing an env is "use whatever the host provides," and
 * "the host provides nothing" is a valid answer that should fall through
 * to the policy default.
 */
function defaultEnvSource(): EnvSource {
  const proc = (globalThis as { process?: { env?: EnvSource } }).process;
  return proc?.env ?? {};
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
 *
 * Worker-safe: when called without an explicit `env`, falls back to
 * `globalThis.process?.env ?? {}` so Cloudflare Worker consumers without
 * `nodejs_compat` get the policy default rather than a `process is not
 * defined` ReferenceError. (Codex / CodeRabbit P1 review feedback on
 * AA PR #82.)
 */
export function readFailOpenFromEnv(env: EnvSource = defaultEnvSource()): boolean {
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
