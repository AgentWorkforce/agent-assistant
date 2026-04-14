# BYOH Agent Framework: Architectural Recommendations

## Governing Rule

**Separate product identity from execution.** Every design decision below follows from this.

## Core Components Every Harness Needs

1. **Bounded Turn Executor** — Accepts a prompt + context, runs an LLM call with tool use, and returns a normalized result. Must have deterministic stop semantics (complete, needs-clarification, approval-required, error).
2. **Tool-Call Contract / Tool Mediation** — The harness needs a tool schema and invocation loop, but tool *choice* belongs upstream per turn. The harness mediates tool execution; it does not own a global registry.
3. **Continuation Emission** — The harness emits structured resumable outcomes (clarification, deferred, approval) rather than silently stalling. However, continuation *persistence, resume, and follow-up delivery* stay outside the adapter and outside the bounded turn.
4. **Capability Manifest** — Machine-readable declaration that goes beyond boolean flags. Should express: streaming mode, tool-call limits, supported continuation outcomes, approval/deferred support, sandbox behavior, and turn/runtime limits. Partial and conditional support must be representable.

## How to Make It BYOH-Compatible

The key insight from this project's execution-adapter boundary: **separate product identity from execution**.

- **Thin Adapter Layer**: Define a canonical `ExecutionRequest → ExecutionResult` contract. Each harness implements an adapter that translates to/from its native format. The adapter owns *only* translation — not policy, memory, sessions, or coordination.
- **Capability Negotiation**: Before dispatching, the orchestrator queries `ExecutionCapabilities`. The harness declares what it supports; the orchestrator decides what to route. No silent flattening.
- **Truthful Degradation**: If a harness can't do X, it says so explicitly via the capability manifest. The orchestrator can fall back or inform the user — never fake success.
- **Context Assembly Stays Upstream**: Turn-context enrichment (memory, project state, user prefs) is the orchestrator's job. The harness receives assembled context, not raw session state.

## What to Adopt From Existing Frameworks

| Framework | Adopt | Skip |
|-----------|-------|------|
| **OpenHarness** | Standardized tool-call schema and result envelope | Over-abstracted middleware chains |
| **OpenClaw** | Plugin discovery and capability introspection | Tight coupling to specific model providers |
| **pi** | Conversational state management and persona layering | Consumer-focused UX patterns |
| **Claude Code** | Permission model (sandbox → ask → allow), iterative tool-use loops, truthful stop reasons | Monolithic CLI coupling |
| **DeepAgents** | Hierarchical task decomposition and plan-then-execute patterns | Heavy orchestration overhead for simple tasks |
| **Open Agents (Vercel)** | Streaming-first execution, edge-compatible adapter pattern | Framework lock-in via Vercel-specific primitives |

## Recommended Architecture

```
Orchestrator (product identity, coordination, policy)
       │
       ▼
  Adapter Contract (ExecutionRequest/ExecutionResult)
       │
       ▼
  ┌────┴────┐
  │  BYOH   │  ← Any harness implementing the adapter interface
  │ Harness  │     (Claude Code, Codex, custom, etc.)
  └─────────┘
```

**Principle**: The adapter is a seam, not a layer. It should be ~100 lines of translation code. If your adapter is getting complex, you're leaking orchestration into it.

**Versioning & Observability**: `ExecutionRequest`, `ExecutionResult`, and capabilities must carry schema versions, correlation/trace IDs, and cancellation/timeout semantics. Without these, debugging multi-harness routing is guesswork.

**v1 Rule**: Route your own first-party harness through the adapter before opening to external backends. Assert parity for: completion, tool use, clarification, approval, and at least one truthful unsupported/degraded case. This proves the contract is real and catches assumptions early.
