The verdict document has been written to `docs/architecture/v1-foundation-integration-review-verdict.md`.

---

## Review Summary

**Verdict: PASS_WITH_FOLLOWUPS**

### Assessment Results

**1. Do the tests prove WF-4 and WF-6 behavior?**

- **WF-4 (`core-sessions.test.ts`):** All 9 plan items covered. One scoping note: test 8 ("dispatch integration") exercises `resolveSession()` directly rather than routing through `runtime.dispatch()`. The mechanism is proven but the full wiring is implied, not demonstrated.
- **WF-6 (`core-sessions-surfaces.test.ts`):** All 10 plan items covered across 6 composite tests. The fanout delivery, inactive-surface skip, dynamic attach/detach, drain-on-stop, concurrency limits, and normalization drop are all exercised.

**2. Package interactions clean and spec-aligned?**

Yes. Core's duck-typed `SessionSubsystem` shape is satisfied structurally by `SessionStore.get()`. The surface registry returns a properly intersected type satisfying both adapter shapes. Sessions and surfaces have zero runtime imports from each other or core. One minor point: the `fanout()` return type asymmetry (`Promise<FanoutResult>` vs `Promise<void>`) is reconciled via a `as` cast rather than structural assignability — worth confirming at compile time.

**3. Changes kept narrow and integration-focused?**

Yes. Exactly two new test files were created. No modifications to `core.ts`, `sessions.ts`, or `surfaces.ts` were required, validating the plan's claim that the contracts were designed with integration in mind from the start.

**4. Follow-ups before next layers:**

Three new items (I-1: confirm fanout return-type at compile time; I-2: rename/improve test 8; I-3: add dedicated full-lifecycle test) plus 10 carried items from prior reviews. The most significant carried items are OQ-2 resolution (max surfaces per session) and inactive-surface behavior in `send()`, both of which need owners before WF-7 assembly.
