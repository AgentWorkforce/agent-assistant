# v1 Policy Review Verdict

**Verdict:** PASS_WITH_FOLLOWUPS
**Date:** 2026-04-12
**Scope reviewed:** `docs/architecture/v1-policy-scope.md`, `docs/specs/v1-policy-spec.md`, `docs/architecture/v1-policy-implementation-plan.md`, `packages/policy/README.md`, `docs/research/policy-runtime-notes.md`

## Findings

### 1. Approval outcome auditing is underspecified for real implementation

The spec says products should update the original audit event after approval resolves by writing an updated `AuditEvent` with `approval` populated, but the engine returns only `PolicyDecision` and does not expose the emitted audit record or its ID (`docs/specs/v1-policy-spec.md:261`, `docs/specs/v1-policy-spec.md:272`, `docs/architecture/v1-policy-implementation-plan.md:310`). In practice, most callers will not have `originalAuditEvent` available unless they reimplement audit event construction in product code or reach into sink internals. That weakens the main audit contract and makes proactive-to-policy approval flows harder to integrate consistently.

Required follow-up: define one concrete v1 pattern for approval resolution recording. The smallest fix is to make `evaluate()` return both `decision` and `auditEventId`, or to add a dedicated engine/helper method for constructing or recording approval resolution updates.

### 2. The spec claims invalid classifier outputs become `ClassificationError`, but the implementation plan does not validate that

The spec and README both say `ClassificationError` is thrown when the classifier throws or returns an invalid risk level (`docs/specs/v1-policy-spec.md:340`, `docs/specs/v1-policy-spec.md:429`, `packages/policy/README.md:359`). The implementation plan only wraps thrown classifier errors and never validates the returned value against the four-level enum (`docs/architecture/v1-policy-implementation-plan.md:268`). That is a direct contract mismatch and will surface late if left to implementation guesswork.

Required follow-up: add explicit runtime validation of classifier output and a test covering invalid returned values.

### 3. The “default-deny posture” language conflicts with the actual default behavior

The scope doc says external actions should have “a default-deny posture for unclassified actions” (`docs/architecture/v1-policy-scope.md:23`), but the package actually defaults unclassified actions to `medium` risk and unmatched rules to `require_approval` (`docs/specs/v1-policy-spec.md:117`, `docs/specs/v1-policy-spec.md:294`). The README also blesses permissive fallback configuration, including `allow` (`packages/policy/README.md:342`). The implementation direction is reasonable, but the posture language is not aligned with the runtime contract.

Required follow-up: change the scope wording to “default block pending approval” or similar, unless the team truly intends unmatched/unclassified actions to resolve to `deny`.

### 4. `workspaceId` is present in rule context but unreachable from the current action/evaluation API

`PolicyEvaluationContext` includes `workspaceId` (`docs/specs/v1-policy-spec.md:169`), but `Action` does not, and the implementation plan’s `evaluate()` context builder never supplies it (`docs/architecture/v1-policy-implementation-plan.md:278`). That leaves a public field with no defined source, which is a package-boundary leak rather than a clean contract.

Required follow-up: either add `workspaceId` to `Action`, accept extra evaluation context as an argument, or remove `workspaceId` from v1.

### 5. One API doc comment is internally incorrect

The spec says `registerRule()` throws `RuleNotFoundError` on duplicate IDs (`docs/specs/v1-policy-spec.md:324`), while the implementation plan correctly throws `PolicyError` (`docs/architecture/v1-policy-implementation-plan.md:234`). This is minor, but it is the kind of inconsistency that causes avoidable test and docs churn.

Required follow-up: fix the spec text and add a duplicate-registration test assertion against `PolicyError`.

## Assessment

### 1. Is the v1 policy scope bounded and realistic?

Yes. The scope is deliberately small and mostly well-defended: in-memory rules only, no approval workflow engine, no scheduler binding, no runtime hooks, no persistence, and no cross-package runtime dependencies (`docs/architecture/v1-policy-scope.md:15`, `docs/specs/v1-policy-spec.md:48`, `docs/architecture/v1-policy-implementation-plan.md:30`). That is an appropriate v0.1.0 slice.

The only scope caveat is the audit/approval seam. Without tightening that, the package can still be implemented, but products will each invent their own resolution-recording pattern.

### 2. Are package boundaries clean?

Mostly yes. The package boundary is conceptually clean: policy owns generic action evaluation, risk vocabulary, rule execution, and audit contracts, while products own action catalogs, approval UX, escalation routing, and proactive wiring (`docs/specs/v1-policy-spec.md:33`, `docs/research/policy-runtime-notes.md:172`). The zero-runtime-dependency posture also helps (`docs/architecture/v1-policy-implementation-plan.md:71`).

The main boundary blemishes are:
- `workspaceId` in context without a source
- the approval-resolution audit flow depending on product access to an internal audit event shape/identity

### 3. Is this strong enough to drive implementation next?

Yes, with follow-ups resolved first. The engine contract, evaluation algorithm, file manifest, and test plan are concrete enough to implement immediately (`docs/specs/v1-policy-spec.md:282`, `docs/architecture/v1-policy-implementation-plan.md:40`, `docs/architecture/v1-policy-implementation-plan.md:410`). This is not missing major architectural decisions.

Implementation should not start until the classifier-validation contract and approval-resolution audit contract are pinned down, because both affect exported behavior and tests.

### 4. Are proactive/policy interactions well-defined enough for future integration?

Mostly yes. The explicit product-side wiring between proactive decisions and policy evaluation is the right boundary, and the required `proactive: boolean` flag is a strong choice that prevents silent downgrades (`docs/research/policy-runtime-notes.md:130`, `docs/research/policy-runtime-notes.md:170`). The “proactive stricter than interactive” rule pattern is also clear enough for product teams to adopt.

What is still missing is a more concrete statement about how proactive-triggered approval outcomes get correlated back into audit records. That is the main remaining integration gap, not the proactive gating model itself.

## Final Verdict

`PASS_WITH_FOLLOWUPS`

The package direction is bounded, realistic, and sufficiently specified to proceed toward implementation. The review did not find a need to reopen the overall architecture. It did find a small set of contract-level inconsistencies that should be corrected before coding begins:

1. Define how approval outcomes are correlated to the original audit record in v1.
2. Validate invalid classifier return values at runtime and test them.
3. Align the “default-deny” wording with the actual fallback behavior.
4. Resolve the orphaned `workspaceId` field in evaluation context.
5. Fix the duplicate-registration error type wording in the spec.

Artifact produced: `docs/architecture/v1-policy-review-verdict.md`

V1_POLICY_REVIEW_COMPLETE
