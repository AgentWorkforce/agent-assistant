# Trajectory: Add memory turn-context helpers

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** April 27, 2026 at 08:37 AM
> **Completed:** April 27, 2026 at 08:42 AM

---

## Summary

Added @agent-assistant/memory helpers for relay-backed store construction, scoped turn memory retrieval, latest session promotion, docs, and tests.

**Approach:** Standard approach

---

## Key Decisions

### Added raw memory helpers in @agent-assistant/memory
- **Chose:** Added raw memory helpers in @agent-assistant/memory
- **Reasoning:** Sage needs reusable scoped retrieval, relay-backed store construction, and latest-session promotion while keeping Slack-specific promotion policy and prompt formatting product-local.

---

## Chapters

### 1. Work
*Agent: default*

- Added raw memory helpers in @agent-assistant/memory: Added raw memory helpers in @agent-assistant/memory
