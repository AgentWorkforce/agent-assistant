# Trajectory: Compare recent sage updates for agent-assistant feature parity

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** May 5, 2026 at 09:52 AM
> **Completed:** May 5, 2026 at 10:03 AM

---

## Summary

Compared recent Sage updates and promoted reusable agent-facing primitives into agent-assistant: expanded public GitHub fetcher/source-navigation APIs, added a bounded public GitHub harness tool registry, added webhook-runtime A2A card/RPC route helpers, exports, docs, dependency wiring, and regression tests. Verified harness and webhook-runtime full test suites and builds.

**Approach:** Standard approach

---

## Key Decisions

### Promote Sage public agent capabilities as SDK primitives
- **Chose:** Promote Sage public agent capabilities as SDK primitives
- **Reasoning:** Recent Sage changes split into product wiring and generic capability gaps; agent-assistant should own reusable A2A route/card helpers and richer public GitHub source-inspection tools so future agents do not reimplement Sage-specific copies.

---

## Chapters

### 1. Work
*Agent: default*

- Promote Sage public agent capabilities as SDK primitives: Promote Sage public agent capabilities as SDK primitives
- Ported the generic parts of Sage's recent agent-facing updates: reusable A2A discovery/RPC route helpers and bounded public GitHub source-inspection tools now live in SDK packages with tests and docs. Left Sage-specific Slack runner orchestration and product skill names in Sage.
