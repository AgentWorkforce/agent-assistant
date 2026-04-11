**Verdict: PASS_WITH_FOLLOWUPS**

Review complete. The verdict file is at `docs/architecture/v1-surfaces-review-verdict.md`.

**Key findings:**

**Passes:**
- All spec types are implemented correctly and exported cleanly
- Factory behavior (register/unregister/get/list/send/fanout/receiveRaw) matches the spec
- Normalization logic covers all field extraction paths from spec §4.10 — `userId` rejection, `text` warning, fallbacks — all correct
- Package boundary enforced: zero runtime deps on core or sessions, confirmed by `package.json`
- Adapter wiring is explicit and clean: structural type aliases, compile-time contract assertions, correct intersection return type
- Sessions integration is correct by absence — fanout receives `string[]`, session resolution stays in core

**Follow-ups (2 blocking before assembly, 2 should-fix, 2 nice-to-have):**

| # | Item | Priority |
|---|---|---|
| F-3 | WF-6 integration test (`core-sessions-surfaces.test.ts`) | **MUST before assembly** |
| F-4 | WF-4 integration test (`core-sessions.test.ts`) | **MUST before assembly** |
| F-1 | OQ-2: `send()` does not guard against inactive surface state | Should-fix |
| F-2 | Concurrency test for fanout `Promise.all` path missing | Should-fix |
| F-5 | Export `SessionSubsystem` from core | Nice-to-have |
| F-6 | Document `normalizationHook` null/undefined drop behavior in README | Nice-to-have |
