**Verdict: PASS_WITH_FOLLOWUPS**

Review written to `docs/architecture/v1-sessions-review-verdict.md`.

**Key findings:**

1. **Spec conformance** — All interfaces, error classes, lifecycle transitions, and factory contracts match the canonical spec exactly. The `SessionResolvableMessage` duck-type is correctly defined locally to avoid a runtime dependency on core.

2. **Core integration shape** — `SessionStore.get()` satisfies core's `SessionSubsystem` structural type without any adapter code. The compile-time assignability check in the test file is correctly placed and will catch future drift. Zero runtime dependencies enforced.

3. **Tests** — All 26 planned tests are present and logically correct. Fake timers are used properly for time-sensitive paths.

4. **Follow-ups before surfaces can begin:**
   - **F-1 (Required):** WF-4 integration test (`core-sessions.test.ts`) — explicitly deferred per plan but must exist before surfaces depends on the sessions+core integration
   - **F-2:** Missing lifecycle transition tests — `expire()` from `created`/`suspended`, `detachSurface()` not-found, `defaultAffinityResolver` surface-preference branch
   - **F-3:** `find()` query filter tests (`workspaceId`, `surfaceId`, `activeAfter`) have no coverage
   - **F-4:** Dead code in `sweepStale` — `ttlMs ?? defaultTtlMs` where `ttlMs: number` is always required
   - **F-5:** `Number.MAX_SAFE_INTEGER` limit in `sweepStale` needs an inline comment for future persistent adapter authors
   - **OQ-2/OQ-3:** Max surfaces per session and expired-record retention policy remain open — need resolution before persistent adapters are written

V1_SESSIONS_REVIEW_COMPLETE
