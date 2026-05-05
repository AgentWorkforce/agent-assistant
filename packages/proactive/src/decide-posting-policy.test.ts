import { describe, expect, it } from 'vitest';

import {
  applyUnverifiedPrefix,
  decidePostingPolicy,
  readFailOpenFromEnv,
  UNVERIFIED_PREFIX,
  type VerifyDraftOutcome,
} from './decide-posting-policy.js';

describe('decidePostingPolicy', () => {
  it('verified outcome → post with text + evidence', () => {
    const outcome: VerifyDraftOutcome<string> = {
      kind: 'verified',
      text: 'PR #42 is merged',
      evidence: ['merge-commit-deadbeef'],
    };
    const decision = decidePostingPolicy(outcome, { failOpen: true });
    expect(decision).toEqual({
      action: 'post',
      text: 'PR #42 is merged',
      evidence: ['merge-commit-deadbeef'],
    });
  });

  it('no_supporting_evidence → block (regardless of fail-open)', () => {
    const outcome: VerifyDraftOutcome = { kind: 'no_supporting_evidence' };
    expect(decidePostingPolicy(outcome, { failOpen: true })).toEqual({
      action: 'block',
      reason: 'no_supporting_evidence',
    });
    expect(decidePostingPolicy(outcome, { failOpen: false })).toEqual({
      action: 'block',
      reason: 'no_supporting_evidence',
    });
  });

  it('bridge_unavailable + failOpen → post_unverified with prefix', () => {
    const outcome: VerifyDraftOutcome = {
      kind: 'bridge_unavailable',
      draftedText: 'I noticed an unresolved question.',
    };
    expect(decidePostingPolicy(outcome, { failOpen: true })).toEqual({
      action: 'post_unverified',
      text: '[unverified] I noticed an unresolved question.',
      reason: 'bridge_unavailable',
    });
  });

  it('bridge_unavailable + failOpen=false → block with verification_unavailable', () => {
    const outcome: VerifyDraftOutcome = {
      kind: 'bridge_unavailable',
      draftedText: 'I noticed an unresolved question.',
    };
    expect(decidePostingPolicy(outcome, { failOpen: false })).toEqual({
      action: 'block',
      reason: 'verification_unavailable',
    });
  });

  it('verification_degraded + failOpen → post_unverified, surfaces reason', () => {
    const outcome: VerifyDraftOutcome = {
      kind: 'verification_degraded',
      draftedText: 'Following up on the deploy thread.',
      reason: 'specialist_returned_partial',
    };
    expect(decidePostingPolicy(outcome, { failOpen: true })).toEqual({
      action: 'post_unverified',
      text: '[unverified] Following up on the deploy thread.',
      reason: 'specialist_returned_partial',
    });
  });

  it('verification_degraded + failOpen=false → block with the same reason', () => {
    const outcome: VerifyDraftOutcome = {
      kind: 'verification_degraded',
      draftedText: 'Following up on the deploy thread.',
      reason: 'specialist_returned_partial',
    };
    expect(decidePostingPolicy(outcome, { failOpen: false })).toEqual({
      action: 'block',
      reason: 'specialist_returned_partial',
    });
  });

  it('post_unverified does not double-prefix already-prefixed text', () => {
    const outcome: VerifyDraftOutcome = {
      kind: 'bridge_unavailable',
      draftedText: '[unverified] already prefixed',
    };
    expect(decidePostingPolicy(outcome, { failOpen: true })).toEqual({
      action: 'post_unverified',
      text: '[unverified] already prefixed',
      reason: 'bridge_unavailable',
    });
  });
});

describe('applyUnverifiedPrefix', () => {
  it('adds the prefix when absent', () => {
    expect(applyUnverifiedPrefix('hi')).toBe('[unverified] hi');
  });

  it('is idempotent', () => {
    const once = applyUnverifiedPrefix('hi');
    expect(applyUnverifiedPrefix(once)).toBe(once);
  });

  it('exposes the prefix as a constant', () => {
    expect(UNVERIFIED_PREFIX).toBe('[unverified] ');
  });
});

describe('readFailOpenFromEnv', () => {
  it('defaults to true when neither env var is set', () => {
    expect(readFailOpenFromEnv({})).toBe(true);
  });

  it('respects AA_PROACTIVE_FAIL_OPEN_VERIFICATION=false', () => {
    expect(readFailOpenFromEnv({ AA_PROACTIVE_FAIL_OPEN_VERIFICATION: 'false' })).toBe(false);
  });

  it('respects the legacy SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION=false alias', () => {
    expect(readFailOpenFromEnv({ SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION: 'false' })).toBe(false);
  });

  it('AA="true" alongside legacy SAGE="false" still fails closed (conservative read)', () => {
    expect(
      readFailOpenFromEnv({
        AA_PROACTIVE_FAIL_OPEN_VERIFICATION: 'true',
        SAGE_PROACTIVE_FAIL_OPEN_VERIFICATION: 'false',
      }),
    ).toBe(false);
  });

  it('non-"false" values do not trigger fail-closed', () => {
    expect(readFailOpenFromEnv({ AA_PROACTIVE_FAIL_OPEN_VERIFICATION: '0' })).toBe(true);
    expect(readFailOpenFromEnv({ AA_PROACTIVE_FAIL_OPEN_VERIFICATION: 'no' })).toBe(true);
    expect(readFailOpenFromEnv({ AA_PROACTIVE_FAIL_OPEN_VERIFICATION: 'False' })).toBe(true);
  });

  it('does not throw on hosts without globalThis.process (pure Workers / browsers)', () => {
    // Codex / CodeRabbit P1 on AA PR #82: previous shape used
    // `env: NodeJS.ProcessEnv = process.env` which threw ReferenceError on
    // Workers without nodejs_compat. Verify the no-arg default falls back
    // safely when `process` is undefined on the host.
    const original = (globalThis as { process?: unknown }).process;
    try {
      delete (globalThis as { process?: unknown }).process;
      expect(() => readFailOpenFromEnv()).not.toThrow();
      expect(readFailOpenFromEnv()).toBe(true);
    } finally {
      if (original === undefined) {
        delete (globalThis as { process?: unknown }).process;
      } else {
        (globalThis as { process?: unknown }).process = original;
      }
    }
  });
});
