# Weekend Delivery Plan

Date: 2026-04-11
Revised: 2026-04-11 (spec-reconciliation pass — all examples updated to match canonical specs; workspace install note added)
Revised: 2026-04-11 (sdk-audit-and-traits-alignment-plan — implementation status reflected; workspace:* gap documented; traits/persona context added)
Target: 2026-04-13 (Sunday night)

> **Canonical source of truth:** Package specs in `docs/specs/` override any example code in this document. All assembly examples below have been updated to match the reviewed specs and `docs/architecture/spec-reconciliation-rules.md`. If a code example conflicts with a spec, **trust the spec, not this document**.

## Implementation Status as of 2026-04-11

**WF-1 through WF-5 are COMPLETE.** The core, sessions, and surfaces packages are implemented and passing tests. The weekend delivery goal was to produce stable v1 type contracts for Sage, MSD, and NightCTO to write product adapter code against. That goal is met.

| Package | Tests | Status |
| --- | --- | --- |
| `@agent-assistant/core` | 44 pass | COMPLETE |
| `@agent-assistant/sessions` | 25 pass | COMPLETE |
| `@agent-assistant/surfaces` | 28 pass | COMPLETE |

**WF-6 is COMPLETE.** `packages/core/src/core-sessions-surfaces.test.ts` (describe block labeled WF-6) covers multi-surface session attachment, fanout, targeted send, and detach behavior.

**WF-7 is OPEN.** The end-to-end assembly test in `packages/examples/src/` does not yet exist. Package READMEs for core (152 lines), sessions (118 lines), and surfaces (175 lines) are substantive — not placeholders. The v1 release tag is gated on the assembly test being written.

**Remaining open items:**
- `@agent-assistant/routing` has a blocking DoD failure (12 tests, 40+ required). Do not wire routing into product code until this is resolved.
- No root `package.json` or monorepo workspace config exists. The `workspace:*` protocol referenced below is the target pattern, not current reality. Use `npm pack` tarballs or path-based installs until a root workspace is configured.

---

## Goal

Sage, MSD, and NightCTO teams can `npm install @agent-assistant/core @agent-assistant/sessions @agent-assistant/surfaces` by Sunday night, with type contracts stable enough to write product adapter code against.

> **npm install note:** For v1, "npm install" means **local monorepo consumption** via workspace references (`"@agent-assistant/core": "workspace:*"`) or `npm pack` tarballs — not the public npm registry. Public publishing is a post-v1 task tracked separately.
>
> **Workspace config gap:** No root `package.json` with workspace configuration currently exists. Each package is independently installable. Until a workspace root is configured, consume packages via `npm pack` tarballs or local path references. This is tracked in the audit plan as D-5.

The v1 type contracts that are now stable:

- `AssistantDefinition` (core)
- `AssistantRuntime` (core)
- `InboundMessage` / `OutboundEvent` (core)
- `CapabilityHandler` / `CapabilityContext` (core)
- `Session` / `SessionStore` (sessions)
- `AffinityResolver` / `resolveSession` (sessions)
- `SurfaceRegistry` / `SurfaceConnection` / `SurfaceAdapter` (surfaces)
- `SurfaceCapabilities` / `SurfaceFormatHook` / `FanoutResult` (surfaces)

---

## Traits and Persona Context

Products using this SDK should understand the distinction between workforce personas and assistant traits before writing product adapter code.

**Workforce personas** are runtime execution profiles (model, harness, system prompt, service tier). These are defined and owned in Workforce infrastructure. They are not imported from this SDK.

**Assistant traits** are identity and behavioral characteristics (voice, style, vocabulary, proactivity level). The `@agent-assistant/traits` package is planned for v1.2. In v1, products define traits as local data objects and inject them manually into persona prompts and format hooks.

See [traits-and-persona-layer.md](../architecture/traits-and-persona-layer.md) for the full boundary definition.

---

## Timeline

### Saturday Morning (2026-04-12, first half)

**Status: COMPLETE (implementation already done)**

All three specs are already `IMPLEMENTATION_READY`. WF-1, WF-2, WF-3 implementations are done and passing.

| Task | Deliverable | Status |
| --- | --- | --- |
| Read and confirm core spec | Mental model of `AssistantDefinition`, `AssistantRuntime`, adapters | DONE |
| Read and confirm sessions spec | Mental model of `Session`, `SessionStore`, `InMemorySessionStoreAdapter` | DONE |
| Read and confirm surfaces spec | Mental model of `SurfaceRegistry`, `SurfaceConnection`, fanout vs targeted send | DONE |
| Scaffold `packages/core` | `package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts` | DONE |
| Scaffold `packages/sessions` | same | DONE |
| Scaffold `packages/surfaces` | same | DONE |

---

### Saturday Afternoon (2026-04-12, second half)

**Status: COMPLETE**

| Workflow | Package | Key output | Status |
| --- | --- | --- | --- |
| WF-1: Define assistant and start runtime | core | `createAssistant`, `AssistantDefinition` validation, `AssistantRuntime`, `runtime.start()` / `runtime.stop()`, `runtime.status()` | COMPLETE — 44 tests |
| WF-2: Handle inbound message via dispatch | core | Capability dispatch table, `runtime.dispatch()`, `AssistantHooks.onMessage` pre-filter, `runtime.emit()` | COMPLETE |
| WF-3: Create and manage sessions | sessions | `createSessionStore`, `InMemorySessionStoreAdapter`, full lifecycle (`touch`, `expire`, `sweepStale`), `attachSurface`, `detachSurface`, `resolveSession` | COMPLETE — 25 tests |

---

### Saturday Evening / Sunday Morning (2026-04-12 evening – 2026-04-13 morning)

**Status: COMPLETE**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-4: Wire session store into runtime | core + sessions | `runtime.register('sessions', store)`, `runtime.get<SessionStore>('sessions')`, `resolveSession` in handler | COMPLETE |
| WF-5: Register surface registry and route messages | core + surfaces | `createSurfaceRegistry`, `SurfaceConnection`, adapter wiring as core relay adapters, inbound normalization, outbound targeted send, `formatHook` | COMPLETE — 28 tests |

---

### Sunday Afternoon (2026-04-13 afternoon)

**Status: UNCERTAIN — verify before marking complete**

| Workflow | Packages | Key output | Status |
| --- | --- | --- | --- |
| WF-6: Multi-surface session fanout | core + sessions + surfaces | Cross-surface session attachment, `surfaceRegistry.fanout()`, targeted-vs-fanout rule validated | **COMPLETE** — `packages/core/src/core-sessions-surfaces.test.ts` |
| WF-7: End-to-end assembly | core + sessions + surfaces | Full inbound→session→handler→emit→format→adapter cycle, validated assembly, examples package | **OPEN** — `packages/examples/src/` not yet created |

---

### Sunday Night (2026-04-13)

**Status: OPEN — consumer readiness verification needed**

Each product team runs the consumer readiness checklist against the released packages:

- [ ] `npm install @agent-assistant/core @agent-assistant/sessions @agent-assistant/surfaces` (resolves via workspace protocol or local tarballs — not the public npm registry for v1)
- [ ] Define an assistant with `createAssistant(definition, adapters)` where `definition.capabilities` is `Record<string, CapabilityHandler>`
- [ ] Wire a `SessionStore` via `runtime.register('sessions', createSessionStore({ adapter }))`
- [ ] Register surfaces via `createSurfaceRegistry()` and wire it as the core relay adapter pair
- [ ] Handle `InboundMessage` through capability dispatch and emit `OutboundEvent` via `context.runtime.emit()`
- [ ] Return formatted responses to the originating surface via targeted send or fanout
- [ ] Write product adapter code against stable v1 types
- [ ] Run the SDK's own tests to verify correct integration

Tag v1 release once all checks pass.

---

## Product-Specific Adoption Paths

### Sage Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. Draft a memory adapter interface stub so v1.1 memory integration can start Monday.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the Sage assistant identity using `createAssistant()`. Wire `createSessionStore({ adapter: new InMemorySessionStoreAdapter() })`. Register a Slack `SurfaceConnection` in a `SurfaceRegistry`. |
| Immediate after v1 | Begin adapter stub for `@agent-assistant/memory` (v1.1). Sage's existing memory patterns are the primary signal for the memory spec. |
| v1.1 gates | Full memory persistence across Sage sessions. Proactive follow-up engine. |
| v1.2 gates | `@agent-assistant/traits` — Sage is a primary extraction signal. Define local `sageTraits` object now so the v1.2 extraction has a concrete pattern to generalize from. |

**What stays in Sage for now:**
- Knowledge and workspace-specific prompt behavior
- Workforce persona definitions (model, harness, system prompt, tier) — these are workforce-owned, not SDK concerns
- Product-specific follow-up heuristics
- Slack-specific UI conventions and block kit templates
- Trait values (voice, style, vocabulary) — define as a local data object; `@agent-assistant/traits` ships at v1.2
- Memory retrieval logic (until v1.1 `@agent-assistant/memory` ships)

**Sage v1 minimum viable assembly:**

```ts
import { createAssistant } from "@agent-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@agent-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@agent-assistant/sessions";
import type { SessionStore } from "@agent-assistant/sessions";
import { createSurfaceRegistry } from "@agent-assistant/surfaces";
import type { SurfaceConnection, SurfaceCapabilities } from "@agent-assistant/surfaces";

// 1. Define the Sage assistant
const definition: AssistantDefinition = {
  id: "sage",
  name: "Sage",
  capabilities: {
    chat: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);

      // Sage domain handler — product-owned logic
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // Sage-specific response
      });
    },
  },
};

// 2. Wire sessions
const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

// 3. Wire surfaces
const slackCapabilities: SurfaceCapabilities = {
  markdown: false,
  richBlocks: true,
  attachments: true,
  streaming: false,
  maxResponseLength: 3000,
};

const slackConnection: SurfaceConnection = {
  id: "sage-slack",
  type: "slack",
  state: "registered",
  capabilities: slackCapabilities,
  adapter: stubSlackAdapter, // provided by relay foundation or product code
  formatHook: (event, caps) => ({ blocks: [{ type: "section", text: event.text }] }),
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

// 4. Create runtime and register subsystems
const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### MSD Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. MSD's cross-surface session design maps directly onto the v1 session model. Focus on the Slack + web multi-surface path.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define the MSD assistant identity. Wire session store. Register Slack and web surface connections in the surface registry. |
| After v1 | Stub `@agent-assistant/policy` interface for approval-mode scaffolding (policy ships in v2 but MSD can define the interface contract early as a passthrough). |
| v1.2 gates | Coordination for review orchestration. Policy for external action governance. |

**What stays in MSD for now:**
- Code review operations and PR workflows
- Review-specific orchestration logic
- PR-specific tools and heuristics
- Workforce persona definitions — owned by Workforce, not imported from SDK
- Coordinator delegation (until v1.2 `@agent-assistant/coordination` ships for product use)

**MSD v1 minimum viable assembly:**

```ts
import { createAssistant } from "@agent-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@agent-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@agent-assistant/sessions";
import type { SessionStore } from "@agent-assistant/sessions";
import { createSurfaceRegistry } from "@agent-assistant/surfaces";
import type { SurfaceConnection } from "@agent-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "msd-review-assistant",
  name: "MSD",
  capabilities: {
    review: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // MSD review handler — product-owned logic

      // Targeted send: reply to originating surface
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // MSD-specific response
      });

      // Session fanout: notify ALL attached surfaces (surfaceId absent, sessionId present)
      // await context.runtime.emit({
      //   sessionId: session.id,
      //   text: "PR review complete — notifying all attached surfaces",
      // });
    },
  },
};

const sessionStore = createSessionStore({ adapter: new InMemorySessionStoreAdapter() });

const slackConnection: SurfaceConnection = {
  id: "msd-slack",
  type: "slack",
  state: "registered",
  capabilities: { markdown: false, richBlocks: true, attachments: true, streaming: false, maxResponseLength: 3000 },
  adapter: stubSlackAdapter,
};

const webConnection: SurfaceConnection = {
  id: "msd-web",
  type: "web",
  state: "registered",
  capabilities: { markdown: true, richBlocks: false, attachments: false, streaming: true, maxResponseLength: 0 },
  adapter: stubWebAdapter,
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);
surfaceRegistry.register(webConnection);

const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

### NightCTO Adoption Path

**Weekend goal:** Wire core + sessions + surfaces. NightCTO exercises more of the SDK than Sage or MSD, but v1 is still the foundation.

| Step | Action |
| --- | --- |
| v1 | Install core, sessions, surfaces. Define NightCTO assistant identity. Wire session store. Register primary Slack surface connection in the registry. |
| v1.1 gates | Memory for per-client continuity. Connectivity for multi-component flows. |
| v1.2 gates | Proactive monitoring and digests. Coordination for specialist orchestration. Routing for model selection and depth/cost decisions. `@agent-assistant/traits` — NightCTO is a primary extraction signal alongside Sage. |

**What stays in NightCTO for now:**
- Founder/CTO communication style and persona — trait values defined locally until v1.2
- Workforce persona definitions — owned by Workforce
- Client-tier and service policy
- Domain-specific specialist lineups (until v1.2 `@agent-assistant/coordination` ships)
- Per-client memory (until v1.1 `@agent-assistant/memory` ships)
- Proactive monitoring (until v1.2 `@agent-assistant/proactive` ships)

**NightCTO v1 minimum viable assembly:**

```ts
import { createAssistant } from "@agent-assistant/core";
import type { AssistantDefinition, InboundMessage, CapabilityContext } from "@agent-assistant/core";
import { createSessionStore, InMemorySessionStoreAdapter, resolveSession, createDefaultAffinityResolver } from "@agent-assistant/sessions";
import type { SessionStore } from "@agent-assistant/sessions";
import { createSurfaceRegistry } from "@agent-assistant/surfaces";
import type { SurfaceConnection } from "@agent-assistant/surfaces";

const definition: AssistantDefinition = {
  id: "nightcto",
  name: "NightCTO",
  capabilities: {
    // v1: single general capability; v1.2 adds specialist routing
    advise: async (message: InboundMessage, context: CapabilityContext) => {
      const store = context.runtime.get<SessionStore>("sessions");
      const session = await resolveSession(
        message,
        store,
        createDefaultAffinityResolver(store),
      );
      await store.touch(session.id);
      await store.attachSurface(session.id, message.surfaceId);

      // NightCTO domain handler — product-owned logic
      await context.runtime.emit({
        surfaceId: message.surfaceId,
        sessionId: session.id,
        text: "...", // NightCTO-specific response
      });
    },
  },
  hooks: {
    onStart: async (runtime) => {
      // NightCTO: register any startup behavior here
    },
  },
};

const sessionStore = createSessionStore({ adapter: new InMemorySessionStoreAdapter() });

const slackConnection: SurfaceConnection = {
  id: "nightcto-slack",
  type: "slack",
  state: "registered",
  capabilities: { markdown: false, richBlocks: true, attachments: true, streaming: false, maxResponseLength: 3000 },
  adapter: stubSlackAdapter,
  formatHook: (event, caps) => ({
    // NightCTO Slack formatting — product-owned
    blocks: [{ type: "section", text: { type: "mrkdwn", text: event.text } }],
  }),
};

const surfaceRegistry = createSurfaceRegistry();
surfaceRegistry.register(slackConnection);

const runtime = createAssistant(definition, {
  inbound: surfaceRegistry,
  outbound: surfaceRegistry,
});
runtime.register("sessions", sessionStore);

await runtime.start();
```

---

## Minimum Shippable v1 (WF-1 through WF-5)

WF-1 through WF-5 are complete. The minimum shippable v1 is achieved. Products can begin adapter work now.

WF-6 and WF-7 remain to validate full integration and update package documentation. They are not blockers for product adoption but are required for the v1 release tag.

---

## Risk Flags

| Risk | Mitigation |
| --- | --- |
| Routing consumed before DoD is cleared | Do not wire `@agent-assistant/routing` into product integrations until F-1 (tests) and F-2 (escalated flag) are resolved |
| No monorepo workspace config exists | Use npm pack or path references until a root package.json is configured; do not assume workspace:* works |
| Traits/persona conflation | Workforce personas stay in workforce; SDK traits are v1.2; in v1 define trait values as local product data objects |
| Spec vocabulary drift causes wrong implementation | Treat `docs/specs/v1-*-spec.md` as the only source of truth; discard any planning doc that conflicts |
| WF-7 README updates not done | Package READMEs are still placeholders; verify and update before tagging v1 release |

---

## After the Weekend: Immediate Next Steps

Once v1 is tagged:

1. **NightCTO and Sage teams begin writing product adapter code** against v1 types, starting with memory adapter stubs
2. **Draft `docs/workflows/connectivity-wf-*.md`** (four workflow specs required by the v1.1 connectivity spec)
3. **MSD team validates cross-surface session behavior** against their existing session architecture using WF-6 as the reference test
4. **Begin v1.1 implementation planning** — memory spec is already IMPLEMENTATION_READY; connectivity spec is already IMPLEMENTATION_READY
5. **Resolve routing DoD failures** (F-1, F-2) before any product attempts to consume `@agent-assistant/routing`
6. **Define local traits objects in Sage, MSD, and NightCTO** — these are the v1.2 extraction signal for `@agent-assistant/traits`

---

## Reuse-First Implementation Note

Weekend implementation work should not assume every package is greenfield. Agents should inspect existing `relay` packages first for reusable capabilities.

For memory specifically:
- prefer the existing `@agent-relay/memory` package
- only build new assistant-side memory code where the assistant contract needs an adapter, composition layer, or assistant-specific extension

This applies to all future package work. Check what exists in Relay/AgentWorkforce repos before building.


## Out of Scope For This Weekend

The following is intentionally deferred beyond the weekend build-out:
- cross-agent memory consolidation / librarian agent behavior

That capability is better treated as a **v5-v8 level** feature after basic memory, coordination, connectivity, and routing layers are stable.
