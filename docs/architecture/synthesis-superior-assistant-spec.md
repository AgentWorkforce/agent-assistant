# Spec: Synthesis Architecture — A Superior Assistant Built on agent-assistant

**Date:** 2026-05-16  
**Status:** Proposal  
**Governing rule:** Product identity is canonical. Execution harnesses are replaceable. Learning is policy-gated.

---

## 1. Purpose and Scope

This document synthesizes a deep comparison of three agent frameworks — this repo (`agent-assistant`), OpenClaw (`openclaw/openclaw`), and Hermes Agent (`NousResearch/hermes-agent`) — into a concrete architectural proposal for building a better assistant than any of the three individually.

The proposal is additive. The existing `agent-assistant` primitive decomposition is the correct foundation. No primitives need to be removed or restructured. What is needed is:

1. Completion of the already-specced execution-adapter seam
2. A new `@agent-assistant/skills` package for policy-gated learning
3. Dynamic trait overlays in `@agent-assistant/traits`
4. Surface-adapter implementations for multi-platform gateway (not a daemon)
5. Unblocking the memory package

---

## 2. Reference Framework Analysis

### 2.1 OpenClaw

**Core model:** Local-first daemon. Single gateway process manages sessions, channels, tools, and events across 20+ messaging platforms.

**Strengths:**
- Workspace isolation per agent (`~/.openclaw/workspace/`)
- Multi-channel inbox unified behind one control plane
- Sandbox security model: tool allowlists per session type (main vs non-main)
- DM pairing policy for untrusted senders
- Voice integration (macOS/iOS wake words, Android continuous)
- Live canvas (A2UI framework)
- ClawHub skill marketplace
- Skills-as-filesystem: `~/.openclaw/workspace/skills/<skill>/SKILL.md` injected into prompt via `AGENTS.md`, `SOUL.md`, `TOOLS.md`

**Gaps:**
- No SDK story — not importable as a library
- No formal capability negotiation — backend is fixed at runtime
- No policy package — governance is ad hoc
- No persistent learning — skills are static `.md` files, no promotion mechanism
- No execution-adapter seam — permanently coupled to the host model provider
- Skills have no versioning, approval, or pruning model

**Key patterns to adopt:**
- Workspace model as a turn-context enrichment source (not as a daemon-level concept)
- Tool allowlist mapped to `@agent-assistant/policy` allow/deny/approve/escalate
- Platform integrations as surface adapters, not a parallel runtime
- Voice and canvas as surface adapters

### 2.2 Hermes Agent

**Core model:** Python-first autonomous agent with a closed learning loop. FTS5 session search, Honcho dialectic user modeling, autonomous skill creation, skill self-improvement during use.

**Strengths:**
- Skills-as-artifacts following the `agentskills.io` open standard — portable, self-improving, community-shareable
- 7 execution backends: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox
- Serverless hibernation — agents wake on demand
- `trajectory_compressor.py` — trajectory compression for training data generation
- Subagent delegation via RPC
- Unified gateway across Telegram, Discord, Slack, WhatsApp, Signal, Email
- Honcho dialectic user modeling across sessions
- FTS5 session search with LLM summarization

**Gaps:**
- No TypeScript SDK — not embeddable as a library in TypeScript products
- No formal package contracts or primitive boundaries
- No capability negotiation — 7 backends but no `negotiate()` contract
- No governance layer — the learning loop runs without policy gates
- Skills grow without a pruning, versioning, or approval model
- No Relay-native fabric equivalent — multi-agent coordination is custom
- Python-first makes it difficult to embed in web/edge/CF Workers deployments

**Key patterns to adopt:**
- Skills-as-evolving-artifacts as a `@agent-assistant/skills` package
- Trajectory-to-skill promotion pipeline (`.trajectories/` already exists in this repo)
- Honcho-style user modeling as dynamic trait overlays in `@agent-assistant/traits`
- Multi-backend execution as `ExecutionAdapter` implementations (already specced)

### 2.3 agent-assistant (this repo)

**Core model:** TypeScript SDK monorepo. 16 packages, 566 tests. Explicitly decomposed runtime primitives. Relay-native. BYOH execution-adapter seam specced but not yet shipped.

**Strengths:**
- Correct primitive decomposition: shell → sessions → surfaces → harness → routing → policy → memory → traits → continuation → inbox → proactive → coordination
- Governing principle: *"Product identity is canonical. Execution harnesses are replaceable."*
- Formal capability negotiation specced (negotiate/describeCapabilities)
- Policy package with allow/deny/approve/escalate classification
- Cloudflare Workers compatible
- Trajectory recording infrastructure already in place (`.trajectories/`)
- BYOH seam architecturally correct and fully specced

**Current gaps:**
- `@agent-assistant/execution-adapter` not yet shipped (Phase 0–1 of SPEC.md)
- `@agent-relay/memory` blocker not resolved
- No skill system — no learning loop
- No platform gateway surface adapters
- Traits are static — no dynamic evolution from user modeling
- No consumer-facing deployment story

---

## 3. What a Superior Architecture Looks Like

The superior assistant combines:
- **agent-assistant's** formal SDK primitives and governance model as the foundation
- **OpenClaw's** platform reach and workspace-isolation patterns as surface adapter implementations
- **Hermes's** persistent learning loop and multi-backend execution as a policy-gated skills system and execution adapters

The unique property none of the three currently has: **identity-portable, policy-gated, multi-backend execution with a persistent learning loop.**

### Core thesis

```
Product identity is canonical.               (agent-assistant principle — keep)
Execution harnesses are replaceable.         (agent-assistant principle — implement fully)
Learning is policy-gated.                    (new principle — skills don't auto-promote without approval)
Platform reach is surface adapters.          (OpenClaw pattern — composable, not a daemon)
Skills are turn-context enrichment inputs.   (Hermes pattern — formalized with SDK contracts)
```

---

## 4. New Package: `@agent-assistant/skills`

This is the primary new package. It closes the gap that neither OpenClaw nor Hermes solves cleanly.

### 4.1 Design Principles

- Skills are **turn-context enrichment inputs**, not filesystem prompt injections
- Skills are **policy-gated**: no skill promotes to active without an approval decision
- Skills are **versioned**: each promotion creates a new version, old versions are retained
- Skills are **prunable**: deprecated skills are marked, not silently deleted
- Skills are **provenance-tracked**: `'trajectory' | 'authored' | 'imported'`
- Skills are **agentskills.io compatible** for interop with Hermes and ClawHub

### 4.2 Core Types

```typescript
interface Skill {
  id: string;
  version: string;
  name: string;
  description: string;
  trigger: SkillTrigger;
  body: SkillBody;
  provenance: 'trajectory' | 'authored' | 'imported';
  approvalStatus: 'pending' | 'approved' | 'deprecated';
  usageStats: SkillUsageRecord[];
  createdAt: string;
  lastUsedAt?: string;
}

interface SkillTrigger {
  type: 'semantic' | 'keyword' | 'domain' | 'explicit';
  pattern: string;
  confidence?: number;  // minimum match confidence for semantic triggers
}

interface SkillBody {
  enrichmentText: string;         // injected into turn-context as enrichment
  toolHints?: string[];           // suggested tools to surface
  voiceOverride?: Partial<AssistantTraits['voice']>;  // optional turn-scoped identity shaping
}

interface SkillRegistry {
  query(input: TurnContextInput): Promise<Skill[]>;
  promote(trajectoryId: string, candidate: SkillCandidate): Promise<Skill>;
  approve(skillId: string, version: string): Promise<Skill>;
  deprecate(skillId: string, reason: string): Promise<void>;
  import(source: 'openclaw' | 'hermes' | 'agentskills', path: string): Promise<Skill[]>;
  export(skillId: string, format: 'agentskills' | 'openclaw'): Promise<SkillExport>;
}
```

### 4.3 Trajectory-to-Skill Promotion Pipeline

The `.trajectories/` infrastructure already exists in this repo. The promotion pipeline is:

```
trajectory completed
  → proactive engine fires post-task analysis
  → SkillExtractor analyzes trajectory for reusable patterns
  → SkillCandidate created with provenance: 'trajectory'
  → policy.evaluate({ type: 'skill-promotion', candidate })
  → if approved: skill.approvalStatus = 'approved', added to registry
  → on next relevant turn: registry.query() returns skill as enrichment input
  → turn-context assembler includes skill.body.enrichmentText
```

This is better than Hermes: the loop is policy-gated. Better than OpenClaw: skills are enrichment inputs with formal contracts, not SKILL.md files injected into a flat prompt.

### 4.4 Turn-Context Integration

```typescript
// In turn-context assembler (extend TurnContextInput)
interface TurnContextInput {
  // ... existing fields
  skillEnrichment?: {
    registry: SkillRegistry;
    maxSkills?: number;      // default 3 — avoid context bloat
    minConfidence?: number;  // default 0.7
  };
}

// SkillRegistry.query() runs at assembly time, not at harness time
// Skills enrich context before execution — they do not replace identity
```

---

## 5. Dynamic Traits: Honcho-Pattern User Modeling

### 5.1 Problem

`@agent-assistant/traits` provides a stable identity floor, but it is static. Neither OpenClaw (static SOUL.md) nor Hermes (Honcho runs outside formal primitive stack) handles this correctly.

### 5.2 Design

Add `DynamicTraitOverlay` to `@agent-assistant/traits`:

```typescript
interface DynamicTraitOverlay {
  sessionId: string;
  userId?: string;
  proposedAt: string;
  approvalStatus: 'pending' | 'applied' | 'rejected';
  changes: Partial<AssistantTraits>;
  evidence: string[];  // trajectory IDs or session summaries supporting this change
  confidence: number;
}

interface DynamicTraitsProvider {
  getEffectiveTraits(base: AssistantTraits, context: TurnContextInput): Promise<AssistantTraits>;
  proposeOverlay(evidence: TraitEvidence): Promise<DynamicTraitOverlay>;
  approveOverlay(overlayId: string): Promise<void>;
  rejectOverlay(overlayId: string): Promise<void>;
}
```

### 5.3 Composition at Turn-Context Assembly Time

```
stable AssistantTraits (traits package — unchanged)
  + approved DynamicTraitOverlay (per user, per context)
  = effectiveTraits fed into TurnContextAssembler
```

Dynamic overlays are **not** harness inputs. They compose at turn-context assembly time. This means they survive execution backend swaps — which is the property neither Hermes's Honcho nor OpenClaw's SOUL.md has.

### 5.4 Proactive Engine Integration

After each session, the proactive engine can propose overlay candidates based on:
- Communication style signals from session transcript
- Domain preference signals from trajectory
- Explicit user feedback events

These are policy-evaluated before application. A user expressing "please be more concise" does not immediately change traits — it creates a `DynamicTraitOverlay` in `pending` state.

---

## 6. Surface Adapters: Platform Gateway Without a Daemon

### 6.1 Problem

OpenClaw's gateway is a separate daemon with its own session management, lifecycle, and routing. This means it cannot be embedded as a library, tested in isolation, or composed with other SDK primitives cleanly.

Hermes's gateway has the same problem.

### 6.2 Design

Platform integrations should be `@agent-assistant/surfaces` implementations — `InboundSurfaceAdapter` and `OutboundSurfaceAdapter` pairs:

```typescript
// Usage — not a daemon, a surfaces configuration
const runtime = createAssistant({
  id: 'my-assistant',
  traits,
  surfaces: [
    createTelegramSurface({ token: process.env.TELEGRAM_TOKEN, dmPolicy: 'paired-only' }),
    createSlackSurface({ token: process.env.SLACK_TOKEN, allowChannels: ['#general'] }),
    createDiscordSurface({ token: process.env.DISCORD_TOKEN }),
    createWebhookSurface({ path: '/webhook', secret: process.env.WEBHOOK_SECRET }),
  ],
});

await runtime.start();
```

### 6.3 Platform Surface Priority Order

| Platform | Priority | Notes |
|---|---|---|
| Telegram | High | Hermes's best-documented platform; large agent-user base |
| Slack | High | OpenClaw's enterprise-facing channel; existing in surfaces package |
| Discord | Medium | OpenClaw/Hermes both support; community use |
| WhatsApp | Medium | OpenClaw supports; requires Business API approval |
| Email | Low | Hermes supports via gateway; lower priority for SDK |
| Voice (macOS) | Low | OpenClaw's differentiator; requires native companion app |

### 6.4 DM Pairing Policy

Adopt OpenClaw's DM pairing model as a `SurfacePairingPolicy` in the policy package:

```typescript
type DmPolicy = 'open' | 'paired-only' | 'allowlist';

interface SurfacePairingPolicy {
  defaultDmPolicy: DmPolicy;
  allowFrom: string[];   // explicit sender allowlist
  requireApproval: boolean;  // whether unknown senders get a pairing code flow
}
```

This is better than OpenClaw because it is formally evaluated by the policy package — not hardcoded in the gateway daemon config.

---

## 7. Multi-Backend Execution Adapters

The BYOH/execution-adapter architecture is already fully specced in `SPEC.md` and `docs/architecture/agent-assistant-runtime-primitive-map.md`. This section maps the Hermes 7-backend model onto execution adapters.

### 7.1 Adapter Implementation Priority

| Adapter | Backend | Priority | Capability Notes |
|---|---|---|---|
| `BuiltInHarnessAdapter` | `@agent-assistant/harness` | **Critical — ship first** | Native tool use, structured continuation, approval interrupts |
| `ClaudeAPIAdapter` | Anthropic Claude API | High | Native tool use; continuation via opaque resume; no approval interrupts |
| `DockerSandboxAdapter` | Docker container + harness | High | Isolated execution; maps to OpenClaw sandbox model |
| `SSHAdapter` | Remote SSH host + harness | Medium | Hermes SSH backend pattern |
| `ModalAdapter` | Modal serverless | Medium | Hermes serverless hibernation pattern |
| `CodexAdapter` | OpenAI Codex | Low | Degraded continuation; no approval interrupts |

### 7.2 Capability Negotiation Matrix

Each adapter's `describeCapabilities()` should return honest values:

| Capability | BuiltIn | ClaudeAPI | DockerSandbox | SSH | Modal |
|---|---|---|---|---|---|
| `toolUse` | `native-iterative` | `native-iterative` | `adapter-mediated` | `adapter-mediated` | `adapter-mediated` |
| `continuationSupport` | `structured` | `opaque-resume` | `structured` | `structured` | `opaque-resume` |
| `approvalInterrupts` | `native` | `none` | `adapter-mediated` | `none` | `none` |
| `traceDepth` | `detailed` | `standard` | `detailed` | `standard` | `minimal` |
| `attachments` | `false` | `true` | `false` | `false` | `false` |
| `maxContextStrategy` | `large` | `large` | `large` | `medium` | `medium` |

The product runtime decides how to handle each `degraded: true` case — not the adapter.

---

## 8. Implementation Roadmap

### Phase 0: Unblock (already in SPEC.md — do first)

- [ ] Resolve `@agent-relay/memory` dependency — publish or extract standalone interface
- [ ] Fix `@agent-assistant/connectivity` package.json exports for vitest
- [ ] Re-run coordination tests and confirm all pass
- [ ] Rebuild and republish all wave-1 npm packages with correct dist/ artifacts

### Phase 1: Execution Adapter (already in SPEC.md)

- [ ] Create `@agent-assistant/execution-adapter` with types from `v1-execution-adapter-spec.md`
- [ ] Implement `BuiltInHarnessAdapter` (~150 lines)
- [ ] Add `toExecutionRequest()` on `@agent-assistant/turn-context`
- [ ] Add `fromExecutionResult()` on `@agent-assistant/continuation`
- [ ] Write conformance test suite for any future adapter

### Phase 2: Skills Package (new)

- [ ] Create `@agent-assistant/skills` package with `Skill`, `SkillTrigger`, `SkillBody`, `SkillRegistry` types
- [ ] Implement filesystem-backed `SkillRegistry` (agentskills.io compatible format)
- [ ] Add `skillEnrichment` input to `TurnContextInput` in `@agent-assistant/turn-context`
- [ ] Add `SkillExtractor` to `@agent-assistant/proactive` — fires post-task, creates `SkillCandidate`
- [ ] Add skill-promotion to `@agent-assistant/policy` action classification
- [ ] Integration test: trajectory → candidate → approval → enrichment → turn execution
- [ ] Add `import` from OpenClaw (`SKILL.md` format) and Hermes (`~/.hermes/skills/`) for migration

### Phase 3: Dynamic Traits (new)

- [ ] Add `DynamicTraitOverlay` and `DynamicTraitsProvider` to `@agent-assistant/traits`
- [ ] Wire overlay composition into `TurnContextAssembler.assemble()` before harness projection
- [ ] Add overlay proposal to `@agent-assistant/proactive` post-session analysis
- [ ] Add overlay approval to `@agent-assistant/policy` action classification
- [ ] Integration test: session signal → overlay proposal → policy approval → effective traits on next turn

### Phase 4: Platform Surface Adapters (new)

- [ ] Add `@agent-assistant/surface-telegram` — `InboundSurfaceAdapter` + `OutboundSurfaceAdapter`
- [ ] Add `@agent-assistant/surface-slack` (may already be partially implemented in surfaces)
- [ ] Add `@agent-assistant/surface-discord`
- [ ] Add `SurfacePairingPolicy` to `@agent-assistant/policy` for DM pairing model
- [ ] Integration test: inbound Telegram message → sessions → turn-context → harness → outbound reply

### Phase 5: Additional Execution Adapters

- [ ] Implement `ClaudeAPIAdapter` — prove degraded continuation path end-to-end
- [ ] Implement `DockerSandboxAdapter` — maps to OpenClaw sandbox model
- [ ] Run conformance suite against all adapters
- [ ] Document adapter authoring guide

### Phase 6: Hardening

- [ ] Update all package versions to 0.2.0 (skills + dynamic traits release)
- [ ] Full test suite target: 800+ passing, 0 blocked suites
- [ ] Publish all packages with correct dist/ artifacts
- [ ] Update `docs/index.md` with synthesis architecture section
- [ ] Add reference examples: Telegram-connected assistant with skill learning loop

---

## 9. Competitive Differentiation Summary

### vs OpenClaw

| Property | OpenClaw | This |
|---|---|---|
| SDK — importable as library | No — daemon only | Yes |
| Capability negotiation | No | Yes — `negotiate()` before every execution |
| Policy governance | Ad hoc config | Formal `@agent-assistant/policy` |
| BYOH — swap execution backend | No | Yes — identity portable across backends |
| Learning loop | Static SKILL.md files | Policy-gated trajectory-to-skill promotion |
| Dynamic identity | Static SOUL.md | `DynamicTraitOverlay` composing at assembly time |
| Platform reach | 20+ platforms (daemon) | Surface adapters (composable, testable) |
| Cloudflare Workers compatible | No | Yes |

### vs Hermes Agent

| Property | Hermes | This |
|---|---|---|
| TypeScript SDK | No — Python-first | Yes |
| Formal package contracts | No | Yes — 16 packages with explicit boundaries |
| Capability negotiation | No — backends picked, not negotiated | Yes |
| Policy governance | No — learning loop runs ungated | Yes — policy gate on every skill promotion |
| Skill versioning and pruning | Minimal | Explicit `approve`, `deprecate` lifecycle |
| Identity portable across backends | No — no identity primitive | Yes — traits compose before harness |
| Relay-native fabric | No | Yes |
| Research/training infrastructure | Yes — trajectory compression | Yes — `.trajectories/` + `trail` |
| Edge/serverless deployment | Partial (Modal, Vercel) | Yes — Workers compatible |

### vs Both

The unique property: **identity is provably portable across execution backends, and the learning loop is policy-gated.**

Neither OpenClaw nor Hermes has both. OpenClaw has no backend portability. Hermes has backend portability but no identity primitive and no policy gate. This architecture has both by design — because the governing principle is *"product identity is canonical, execution harnesses are replaceable"* and the new principle is *"learning is policy-gated."*

---

## 10. What to Skip (and Why)

| Pattern | Source | Reason to Skip |
|---|---|---|
| Daemon gateway architecture | OpenClaw, Hermes | Platform integrations must be surface adapters — testable, embeddable, not a parallel runtime |
| Ungated autonomous skill promotion | Hermes | Skills that self-improve without approval create governance risk and skill bloat |
| Static SOUL.md persona | OpenClaw | Identity that can't evolve is not an identity primitive — it's a config file |
| Python-first implementation | Hermes | TypeScript SDK purity is a core differentiator for edge/Workers deployments |
| Monolithic tool registry | OpenClaw | Tool choice belongs upstream per turn per the existing harness spec |
| Over-abstracted middleware chains | General | The adapter is a seam, not a pipeline |
| Consumer UX patterns | Both | This is an SDK — UX belongs in the product layer |

---

## Appendix A: Governing Principles (Extended)

The original principle from this repo:
> Product identity is canonical. Execution harnesses are replaceable. Relay remains the coordination fabric.

Two new principles added by this synthesis:
> Learning is policy-gated. No skill or trait overlay becomes active without an explicit approval decision.

> Platform reach is surface adapters. No platform integration should require a separate daemon or runtime.

These three principles together define what makes this architecture superior to both reference frameworks.

---

## Appendix B: Migration Paths

For users of OpenClaw or Hermes who want to adopt this SDK:

**From OpenClaw:**
1. `SKILL.md` files → `SkillRegistry.import('openclaw', path)` — converted to `Skill` with `provenance: 'imported'`, `approvalStatus: 'pending'`
2. `SOUL.md` → `AssistantTraits` base definition — one-time migration
3. `AGENTS.md` / `TOOLS.md` → product-owned turn-context shaping (product intelligence layer)
4. Sandbox config → `DockerSandboxAdapter` capability negotiation

**From Hermes:**
1. `~/.hermes/skills/` → `SkillRegistry.import('hermes', path)` — agentskills.io compatible
2. Provider config → `ExecutionAdapter` selection via `@agent-assistant/routing`
3. `trajectory_compressor.py` outputs → compatible with `.trajectories/compacted/` format
4. Honcho user modeling → `DynamicTraitOverlay` proposals from `@agent-assistant/proactive`
