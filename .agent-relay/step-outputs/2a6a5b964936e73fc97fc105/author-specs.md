All six spec files already exist on disk and are complete. Here's a summary of what's in place:

**All files verified as present and ending with `SPEC_READY`:**

| File | Status | Sections |
|---|---|---|
| `docs/specs/v1-core-spec.md` | IMPLEMENTATION_READY | Responsibilities, non-goals, 9 interface types, package boundaries, dependency rules, OSS/cloud split, 7 open questions, 7-step impl slice |
| `docs/specs/v1-sessions-spec.md` | IMPLEMENTATION_READY | Session lifecycle state machine, 7 interface types + error classes, storage adapter pattern, affinity resolver, 5 open questions, 7-step impl slice |
| `docs/specs/v1-memory-spec.md` | IMPLEMENTATION_READY | 5 scope kinds, 10 interface types, promotion/compaction contracts, scope inclusion rules, 5 open questions, 8-step impl slice |
| `docs/specs/v1-surfaces-spec.md` | IMPLEMENTATION_READY | Surface lifecycle, 11 interface types, inbound normalization table, fanout behavior detail, 5 open questions, 7-step impl slice |
| `docs/specs/v1-connectivity-spec.md` | IMPLEMENTATION_READY | 5 message classes, 11 signal classes, signal lifecycle, suppression window, routing escalation hook, 4 workflow shapes (WF-C1–C4), 5 open questions, 8-step impl slice |
| `docs/specs/v1-routing-spec.md` | IMPLEMENTATION_READY | 3-tier mode model (cheap/fast/deep), 7-rule decision algorithm, cost envelope tracking, Workforce design notes, connectivity integration, 6 open questions, 7-step impl slice |

**Key design properties across all specs:**
- Relay foundation is kept beneath all packages via adapter interfaces (never imported directly)
- Workforce routing patterns are explicitly reflected in the routing spec (§9)
- OSS vs cloud boundaries are clear in every spec — all core types and factories are OSS; storage/transport implementations may be cloud-specific
- Dependency rules tables enforce acyclic package graph with core at the root
- Each spec's "Definition of done" maps to a named workflow (WF-1 through WF-7 + WF-C1 through WF-C4)
