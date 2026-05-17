# Spec: OpenKaren — Token-Conscious Proactive Agent Assistant

**Date:** 2026-05-17  
**Status:** Proposal  
**Governing rule:** Every token costs money. Every action should be necessary. Identity is portable. Learning is gated.

---

## 1. What OpenKaren Is

OpenKaren is a hosted personal agent assistant built on the `agent-assistant` SDK, designed around three properties that neither OpenClaw nor Hermes Agent has:

1. **Token consciousness** — the assistant knows exactly what it costs to run, surfaces that cost to the user, and actively minimizes unnecessary spend through compression, smart routing, and budget-gated policy
2. **Proactive by default** — the assistant acts ahead of the user via scheduled triggers (relaycron), integration watches (relayfile), and multi-agent delegation — not just in response to messages
3. **Multi-surface with session bridging** — Karen is reachable on Telegram and Slack simultaneously; conversations bridge seamlessly across surfaces so context is never lost when the user switches channels

**Pricing:** $75/month hosted. Runs on a Mac mini. Reachable via Telegram and Slack.

**Tagline:** *"Your assistant that watches your integrations, surfaces what matters, never burns your budget, and follows you wherever you work."*

---

## 2. The Full Component Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER LAYER                                    │
│                                                                      │
│   Telegram ──────────────────────────────────────────────────────   │
│   (polling mode local; webhook hosted)                              │
│                                                                      │
│   Slack ─────────────────────────────────────────────────────────   │
│   (OAuth via Nango; bot token; thread-native replies)               │
│                                                                      │
│   ← sessions package bridges conversations across both surfaces →   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    OPENKAREN RUNTIME (agent-assistant SDK)           │
│                                                                      │
│  @agent-assistant/core          ← OpenKaren assistant definition     │
│  @agent-assistant/sessions      ← cross-surface session continuity   │
│  @agent-assistant/surfaces      ← Telegram + Slack + relaycast       │
│  @agent-assistant/traits        ← OpenKaren identity floor           │
│  @agent-assistant/turn-context  ← token-aware context assembly       │
│  @agent-assistant/policy        ← BYOK budget gates + approvals      │
│  @agent-assistant/routing       ← budget-aware model selection       │
│  @agent-assistant/harness       ← bounded turn execution             │
│  @agent-assistant/memory        ← session history + user modeling    │
│  @agent-assistant/proactive     ← watch rules + scheduled follow-ups │
│  @agent-assistant/inbox         ← Nango/Composio/Pipedream ingress   │
│  @agent-assistant/continuation  ← resumable unfinished turns         │
│  @agent-assistant/coordination  ← delegation to Sage, Ricky         │
└──────────┬─────────────────────────────────┬────────────────────────┘
           │                                 │
┌──────────▼──────────┐       ┌─────────────▼──────────────────────────┐
│   RELAY FABRIC       │       │       TOKEN CONSCIOUSNESS LAYER         │
│                      │       │                                         │
│  relayfile           │       │  burn    ← spend attribution + budget  │
│  (SaaS VFS)          │       │  rtk     ← command output compression  │
│                      │       │  tilth   ← structural code navigation  │
│  relaycast           │       │  tokensave ← semantic graph queries    │
│  (agent messaging)   │       │  workshop  ← trace viewer + evals      │
│                      │       └─────────────────────────────────────────┘
│  relaycron           │
│  (scheduling)        │
└──────────┬───────────┘
           │  ↕ bidirectional bridge
┌──────────▼──────────────────────────────────────────────────────────┐
│              RELAY ↔ N8N AUTOMATION BRIDGE                           │
│                                                                      │
│  n8n-nodes-relayfile   ← relayfile events → n8n workflow triggers   │
│  (Trigger + Action nodes; polls VFS; fires on create/update/delete) │
│                                                                      │
│  relaycast-n8n-bridge  ← relaycast channel msgs → n8n webhooks      │
│  (glob pattern routing; agent findings → Slack/Jira/PagerDuty)      │
└──────────┬───────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────┐
│                  N8N AUTOMATION LAYER (self-hosted)                  │
│                                                                      │
│  n8n    ← receives from bridge; sends back to Karen's inbox          │
│  workflows: Stripe alerts, calendar prep, GA4 summaries, etc.        │
└──────────┬───────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────┐
│                  COORDINATION & SPECIALISTS                          │
│                                                                      │
│  Sage    ← planning assistant (deep research, architecture)          │
│  Ricky   ← workflow reliability (debug, repair, restart)             │
│  Agent Relay ← multi-agent fabric                                    │
│  workforce personas ← Karen + specialist persona definitions         │
└─────────────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────┐
│                  INTEGRATION PLANE                                   │
│                                                                      │
│  Nango      ← OAuth management (hosted; no local option)            │
│  Composio   ← tool/integration platform (hosted)                    │
│  Pipedream  ← workflow automation (hosted)                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Token Consciousness — The Core Differentiator

This is what neither OpenClaw nor Hermes has. OpenKaren is the only assistant that treats token spend as a first-class runtime concern.

### 3.1 The Four Token-Saving Layers

**Layer 1: Burn — Attribution and Budget Gates**

[`AgentWorkforce/burn`] is the financial ledger for all token activity. Every OpenKaren session is stamped at launch:

```typescript
// Burn stamping in session start hook
await burn.stamp(sessionId, {
  persona: 'karen',
  userId: context.userId,
  workflowId: context.workflowId,
  tier: 'hosted-$75',
});
```

Budget gate in `@agent-assistant/policy`:
```typescript
// Pre-turn policy check
const monthlySpend = await burn.getMonthlySpend(userId);
const budget = 75.00; // USD
const remainingRatio = (budget - monthlySpend) / budget;

if (remainingRatio < 0.1) {
  return { outcome: 'deny', reason: 'monthly-budget-exhausted' };
}
if (remainingRatio < 0.25) {
  return { outcome: 'route-downgrade', targetTier: 'economy' };
}
```

Budget-aware routing in `@agent-assistant/routing`:
```typescript
// If >75% of budget spent, route to cheaper model
const tier = policy.getRoutingTier(userId);  // 'premium' | 'standard' | 'economy'
const model = {
  premium:  'claude-opus-4-7',    // deep planning, complex reasoning
  standard: 'claude-sonnet-4-6',  // most turns
  economy:  'claude-haiku-4-5',   // budget-near-exhausted turns
}[tier];
```

Burn metrics surfaced to user via Telegram on demand:
```
/spend → "This month: $31.42 / $75. Top cost: workflow debugging (42%), Linear watches (28%)"
/forecast → "At current rate you'll reach budget in 18 days."
```

**Layer 2: RTK — Command Output Compression (60–90% reduction)**

[`rtk-ai/rtk`] is a Rust binary that intercepts shell commands and compresses output before it enters the context window. Used by OpenKaren for all tool-bearing turns:

- `git status` → compressed diff summary (not full output)
- `npm test` → failures only, not full test runner output  
- `docker ps` → filtered container listing
- `ls -la` → grouped file listing

RTK integrates as a bash hook — no code changes required. All tool-bearing harness turns go through the RTK proxy:

```typescript
// In OpenKaren's harness configuration
const harness = createHarness({
  toolWrapper: rtkProxy,  // wrap all tool executions through rtk
  ...harnessConfig,
});
```

Expected savings: 60–90% reduction on bash/tool outputs.

**Layer 3: Tilth — Structural Code Navigation (40% reduction)**

[`jahala/tilth`] is a Rust MCP server using tree-sitter for AST-based code navigation. Instead of reading full files, Karen navigates code structurally:

- `tilth src/policy/index.ts` → structural outline (not full file content)
- `tilth createAssistant --scope src/` → symbol definition + context (not grep over all files)
- Line-range drill-down only on the specific section needed

Integrated as an MCP server in Karen's harness tool surface:
```json
{
  "mcpServers": {
    "tilth": { "command": "tilth", "args": ["--mcp"] }
  }
}
```

Expected savings: ~40% average across file navigation operations. Accuracy improves from 76% → 86% (less irrelevant context confusing reasoning).

**Layer 4: TokenSave — Semantic Graph Queries (93% reduction on retrieval)**

[`aovestdipaperino/tokensave`] builds a pre-indexed semantic knowledge graph of connected codebases. Instead of scanning files for symbol lookups:

- `tokensave.callers("createAssistant")` → instant caller list, no file scan
- `tokensave.impact("@agent-assistant/policy")` → dependency impact graph
- `tokensave.search("budget gate")` → FTS5 semantic search returning only matching symbols

Expected savings: 93% mean retrieval savings across codebase queries. A 15,475-token raw query drops to 460 tokens.

Integrated as an MCP server alongside tilth:
```json
{
  "mcpServers": {
    "tokensave": { "command": "tokensave-server", "args": ["--workspace", "/workspace"] }
  }
}
```

### 3.2 Token Budget Dashboard

**Workshop** [`raindrop-ai/workshop`] provides real-time trace visualization — every token, tool call, and span as Karen executes. Runs locally on `localhost:5899` against `~/.raindrop/raindrop_workshop.db`.

**RTK gain** shows command-level savings: per-command reduction percentages, 30-day savings, adoption rates.

**Burn dashboard** surfaces: spend by persona, spend by workflow, spend by session, cache hit rates, overhead attribution.

**Tilth + TokenSave** report per-call token metrics showing exact savings per invocation — this feeds into burn's overhead attribution model.

Together these form the token consciousness dashboard: a unified view of where every dollar is going, which workflows are expensive, and what the model forecast is for the rest of the month.

---

## 4. Proactive Architecture

OpenKaren is proactive by default, not reactive. The three trigger mechanisms:

### 4.1 Scheduled Triggers (relaycron)

[`AgentWorkforce/relaycron`] — Node.js + SQLite scheduler, fully local, WebSocket delivery.

```typescript
// Karen's default proactive schedule
await relaycron.schedule({
  name: 'daily-standup',
  cron: '0 9 * * 1-5',  // 9am weekdays
  tz: 'America/New_York',
  deliver: { via: 'websocket', channel: 'karen-proactive' },
});

await relaycron.schedule({
  name: 'weekly-spend-review',
  cron: '0 17 * * 5',   // Friday 5pm
  tz: 'America/New_York',
  deliver: { via: 'websocket', channel: 'karen-proactive' },
});
```

Each scheduled event fires the proactive engine in `@agent-assistant/proactive`, which:
1. Assembles turn-context from current memory + relayfile state
2. Routes through budget-aware model selection
3. Delivers to Telegram surface

### 4.2 Integration Watches (relayfile)

[`AgentWorkforce/relayfile`] exposes SaaS integrations as a VFS. Karen watches for changes:

```typescript
// Watch rules in @agent-assistant/proactive
const watches = [
  {
    path: '/linear/issues',
    event: 'created',
    trigger: async (file) => await karen.proactiveReply({
      text: `New issue assigned: ${file.title}. Want me to investigate?`,
    }),
  },
  {
    path: '/github/repos/*/pulls',
    event: 'opened',
    trigger: async (file) => await karen.proactiveReply({
      text: `PR opened: ${file.title}. Checking for blocking issues...`,
    }),
  },
  {
    path: '/notion/pages',
    event: 'updated',
    filter: (file) => file.assignee === context.userId,
    trigger: async (file) => await karen.proactiveReply({
      text: `Page updated: ${file.title}`,
    }),
  },
];
```

relayfile write-through invalidation means Karen sees integration changes within ~500ms.

### 4.3 Multi-Agent Coordination (relaycast + Agent Relay)

[`AgentWorkforce/relaycast`] is "Headless Slack for AI agents" — Karen delegates to specialists via relaycast channels:

```
User asks Karen complex architecture question
  → Karen routes to Sage via relaycast (planning + deep research)
  → Sage responds with structured plan
  → Karen synthesizes and delivers to user via Telegram

Workflow breaks overnight
  → relaycron fires Karen's monitoring tick
  → Karen detects failure via relayfile (GitHub Actions watch)
  → Karen delegates to Ricky via relaycast
  → Ricky debugs, repairs, restarts
  → Karen reports outcome to user next morning
```

Delegation uses `@agent-assistant/coordination` specialist model:
```typescript
// Karen delegates to Sage for planning tasks
const delegation = await coordination.delegate({
  to: 'sage',
  via: relaycast,
  input: { type: 'planning', userRequest: turn.message },
  timeout: 120_000,
  onResult: (memo) => karen.synthesize(memo),
});
```

---

## 5. Multi-Surface Support and Session Bridging

### 5.1 Surfaces: Telegram + Slack

Karen runs two surfaces simultaneously via `@agent-assistant/surfaces`. Slack is already partially implemented in the SDK (Slack progress stream helpers, Slack thread gate tests pass in CI). Nango manages the Slack OAuth token — no manual bot configuration required during onboarding.

```typescript
const runtime = createAssistant({
  id: 'karen',
  traits: karenTraits,
  surfaces: [
    createTelegramSurface({
      token: relay.byok('telegram'),
      mode: 'polling',          // local Mac mini; no webhook needed
    }),
    createSlackSurface({
      token: nango.getToken('slack-bot'),   // Nango manages OAuth lifecycle
      signingSecret: relay.byok('slack-signing'),
      replyMode: 'thread',      // always reply in-thread, not channel
      allowChannels: ['#karen', '#general'],
      dmPolicy: 'open',         // DMs always accepted
    }),
  ],
});
```

**What Nango handles for Slack:**
- Initial OAuth flow (user authorizes Karen's Slack app)
- Bot token storage and refresh
- Workspace-level token isolation per user
- Token rotation without Karen's runtime restarting

### 5.2 Cross-Surface Session Bridging

`@agent-assistant/sessions` provides cross-surface session continuity — the same session can be active on multiple surfaces simultaneously. Karen uses this to bridge conversations:

```
User messages Karen on Telegram at 9am → session S1 starts
User DMs Karen on Slack at 11am → sessions package attaches to S1
  - Karen recognizes the same user
  - Full conversation context from Telegram is available
  - Reply goes to Slack; future Telegram messages still reference same session
```

Session affinity rules in Karen's persona:
```typescript
const sessionConfig = {
  // Same user on different surfaces → same session
  crossSurfaceAffinity: 'user-identity',

  // How long before surfaces lose affinity and start fresh sessions
  surfaceAffinityTtl: '4h',

  // Which surface gets proactive messages when multiple are active
  proactiveSurfacePreference: 'most-recent-active',
};
```

### 5.3 Surface Routing Rules

Not every message goes to every surface. Karen applies routing rules at delivery time:

| Message Type | Telegram | Slack | Logic |
|---|---|---|---|
| User-initiated reply | ✓ | ✓ | Reply on the surface where the message arrived |
| Proactive (low urgency) | ✓ | — | Primary surface only (default: Telegram) |
| Proactive (high urgency) | ✓ | ✓ | Both surfaces — don't miss it |
| `/spend` report | ✓ | ✓ | Both, so user sees it wherever they are |
| Ricky finding (critical) | ✓ | ✓ | Both + Slack #incidents channel |
| Sage plan complete | — | ✓ | Slack preferred for long-form structured output |
| Daily standup | ✓ | — | Telegram only — personal, not team-facing |

```typescript
// In proactive engine delivery config
const deliveryRules: SurfaceDeliveryRule[] = [
  { when: { urgency: 'critical' },            surfaces: ['telegram', 'slack'] },
  { when: { type: 'spend-report' },           surfaces: ['telegram', 'slack'] },
  { when: { type: 'structured-plan' },        surfaces: ['slack'] },
  { when: { type: 'daily-standup' },          surfaces: ['telegram'] },
  { when: { urgency: 'low' },                 surfaces: ['most-recent-active'] },
];
```

### 5.4 Slack Thread Context as Turn Enrichment

Slack threads carry rich context Karen can read. When a user invokes Karen inside a Slack thread (e.g., `@Karen can you summarize this?`), the surfaces package captures the thread history and feeds it into `@agent-assistant/turn-context` as enrichment — Karen responds with full awareness of the thread without the user having to re-explain.

```typescript
// Surfaces package thread enrichment (already implemented for Slack progress streams)
createSlackSurface({
  threadContextDepth: 20,      // include up to 20 prior thread messages
  threadContextAsEnrichment: true,  // fed into turn-context, not system prompt
});
```

This is the integration point where Nango's Slack token and relayfile's Slack provider converge: relayfile can watch Slack channels for new messages that reference specific topics (e.g., `mention:incident`), while the surfaces package handles direct Karen interactions inside threads.

### 5.5 Nango as the OAuth Foundation for All Surfaces

Nango manages OAuth for both Slack (surface) and relayfile's Slack provider (VFS integration). This avoids two separate auth flows for the same workspace:

```
User connects Slack once (Nango OAuth flow)
  → Nango stores bot token + user token
  → Karen's Slack surface reads bot token from Nango
  → relayfile's Slack adapter reads user token from Nango
  → relaycast-n8n-bridge posts to Slack via the same token
```

Single Slack connection → surfaces for conversation + VFS for data + bridge for agent findings.

---

## 6. Local vs Hosted Breakdown

### What Runs on the Mac Mini (Fully Local)

| Component | Local? | Notes |
|---|---|---|
| `agent-assistant` SDK | Yes | TypeScript runtime |
| relayfile server | Yes | Go server + docker-compose |
| relaycron | Yes | Node.js + SQLite, port 4007 |
| relaycast local daemon | Yes | Rust daemon, 127.0.0.1:7528 |
| burn | Yes | SQLite at `~/.agentworkforce/burn/` |
| rtk | Yes | Single Rust binary, bash hook |
| tilth | Yes | Rust binary + MCP server |
| tokensave | Yes | MCP server + libSQL |
| workshop (raindrop) | Yes | TypeScript daemon + Vite UI, localhost:5899 |
| n8n | Yes | Self-hosted automation, port 5678 |
| n8n-nodes-relayfile | Yes | npm package installed in n8n instance |
| relaycast-n8n-bridge | Yes | TypeScript daemon; Docker or bare Node |
| Telegram (polling mode) | Yes | No webhook required locally |
| Slack surface | Partial | Bot runs locally; Slack events require public URL (Cloudflare Tunnel) |
| workforce personas | Yes | JSON config files |

### What Requires Cloud (Cannot Run Fully Local)

| Component | Cloud Required? | Why |
|---|---|---|
| relaycast (webhooks) | Partial | External webhook triggers require public URL; local daemon works for agent-to-agent messaging; Telegram inbound works via polling |
| Nango | Yes | OAuth management is their hosted service |
| Composio | Yes | Integration platform is hosted |
| Pipedream | Yes | Workflow automation is hosted |
| Sage (cloud mode) | Yes | If using hosted Sage |
| Agent Relay (cloud) | Yes | If using hosted multi-agent fabric |

### Relaycast Webhook Decision

The user correctly noted: *"Relaycast? No, not if want webhooks."*

For OpenKaren on a Mac mini:
- **Agent-to-agent messaging** (Karen ↔ Sage ↔ Ricky): relaycast local daemon — fully local, no webhooks needed
- **Telegram inbound**: use polling mode (`getUpdates`) — no webhook required
- **External webhooks** (Nango, Composio, Pipedream, n8n): require hosted relaycast or a tunnel (ngrok/Cloudflare Tunnel) for the Mac mini to receive external HTTP

**Recommended local webhook solution:** Cloudflare Tunnel (free tier) pointing at the Mac mini's relaycast port. This keeps the Mac mini running fully locally while receiving external webhook deliveries without port-forwarding or static IP.

```bash
# One-time setup
cloudflared tunnel create openkaren
cloudflared tunnel route dns openkaren karen.yourdomain.com
cloudflared tunnel run --url http://localhost:7528 openkaren
```

---

## 7. Workforce Persona: Karen

[`AgentWorkforce/workforce`] defines Karen as a deployable persona JSON:

```json
{
  "id": "karen",
  "name": "OpenKaren",
  "version": "1.0.0",
  "description": "Token-conscious proactive personal assistant",
  "intent": "Proactively surface what matters, minimize token spend, delegate complexity",

  "traits": {
    "voice": "direct",
    "formality": "casual-professional",
    "proactivity": "high",
    "riskPosture": "moderate",
    "domain": "general"
  },

  "executionTiers": [
    {
      "name": "premium",
      "harness": "built-in",
      "model": "claude-opus-4-7",
      "condition": "budget.remainingRatio > 0.75 && task.complexity == 'high'"
    },
    {
      "name": "standard",
      "harness": "built-in",
      "model": "claude-sonnet-4-6",
      "condition": "budget.remainingRatio > 0.25"
    },
    {
      "name": "economy",
      "harness": "built-in",
      "model": "claude-haiku-4-5",
      "condition": "budget.remainingRatio <= 0.25"
    }
  ],

  "integrations": {
    "relayfile": {
      "providers": ["linear", "github", "notion", "slack"],
      "watches": ["issues/created", "pulls/opened", "pages/updated"]
    },
    "relaycast": {
      "specialists": ["sage", "ricky"]
    },
    "relaycron": {
      "schedules": ["daily-standup", "weekly-spend-review", "workflow-health-check"]
    },
    "inbox": {
      "sources": ["nango", "composio", "pipedream", "n8n"]
    }
  },

  "permissions": {
    "allow": ["read", "write", "bash", "relayfile/*", "relaycast/send"],
    "requireApproval": ["delete", "deploy", "spend > 5.00"],
    "deny": ["admin", "billing-modify"]
  },

  "memory": {
    "scope": "user",
    "ttl": "90d",
    "include": ["preferences", "workflow-history", "spend-patterns"]
  },

  "tokenConsciousness": {
    "burn": { "enabled": true, "budgetUSD": 75.00 },
    "rtk": { "enabled": true, "wrapAllBashTools": true },
    "tilth": { "enabled": true, "mcpServer": true },
    "tokensave": { "enabled": true, "mcpServer": true }
  },

  "surfaces": ["telegram", "slack"],
  "surfaceBridging": {
    "crossSurfaceAffinity": "user-identity",
    "surfaceAffinityTtl": "4h",
    "proactiveSurfacePreference": "most-recent-active",
    "urgentDelivery": "all-surfaces"
  },
  "sandbox": { "mode": "none" },
  "subscription": { "tier": "byok", "billing": "relay-byok" }
}
```

---

## 8. BYOK Subscription Model

Users bring their own API keys (Anthropic, OpenAI, etc.) via Relay's BYOK infrastructure. OpenKaren charges $75/month for the platform, not for model tokens.

```
$75/month covers:
  - Karen runtime (agent-assistant SDK hosting)
  - relayfile SaaS VFS (integration syncs)
  - relaycast (agent messaging fabric)
  - relaycron (scheduling)
  - burn dashboard
  - Setup assistance for Nango, Composio, Pipedream

User pays separately:
  - Anthropic API tokens (BYOK via Relay)
  - Nango subscription (if needed)
  - Composio plan (if needed)
```

Token consciousness tooling (rtk, tilth, tokensave) directly reduces the user's Anthropic API bill — this is a concrete selling point. A user spending $50/month on raw Claude API calls might save $20–40/month through Karen's compression layers.

Marketing angle: *"Karen doesn't just cost $75/month. She pays for part of herself through token savings."*

---

## 9. Integration Setup (What Gets Configured)

### What the User Sets Up (Guided Onboarding)

```
1. Nango → Slack OAuth (single flow; covers all three Slack uses)
   - Karen's Slack surface bot token (for conversation surface)
   - relayfile's Slack provider token (for VFS sync of Slack messages)
   - relaycast-n8n-bridge posting token (for agent findings → Slack)
   One connection. Three consumers. Nango handles refresh.

2. Nango → OAuth for remaining integrations: Linear, GitHub, Notion,
   HubSpot, Salesforce
   (relayfile uses these for VFS sync; n8n-nodes-relayfile Trigger reads
   the same workspace)

3. Composio → additional tool integrations
   (composio tools surface through @agent-assistant/inbox)

4. Pipedream → automation workflows that trigger Karen
   (webhook delivery to Karen's inbox surface)

5. n8n → self-hosted automations connecting internal tools
   (HTTP webhooks to Karen's inbox; relayfile Trigger Node already
   wired; relaycast-n8n-bridge already wired)
```

### What the Platform Pre-Wires (No User Config)

```
- relayfile workspace (pre-provisioned)
- relaycast channels (karen-main, karen-proactive, karen-coordination, karen-findings/*)
- relaycron schedules (daily standup, weekly review)
- burn stamping (automatic for all sessions)
- rtk bash hook (automatic in harness tool wrapper)
- tilth MCP server (auto-started with Karen runtime)
- tokensave semantic index (auto-built on first integration sync)
- workflow personas (sage, ricky pre-registered in relaycast)
- n8n-nodes-relayfile installed in n8n instance
- relaycast-n8n-bridge running as daemon with default glob routes
- n8n base workflows (severity router, inbox forwarder, Notion writeback)
```

---

## 10. n8n Integration — Bidirectional Automation Mesh

The relay ↔ n8n integration is fully bidirectional through two dedicated bridge packages. This is not a simple "n8n can call Karen" setup — it is an automation mesh where relayfile events and relaycast agent messages both flow into n8n, and n8n flows back into Karen.

### 9.1 relayfile → n8n: `n8n-nodes-relayfile`

[`AgentWorkforce/n8n-nodes-relayfile`] is a community n8n node package with three node types:

**Relayfile Trigger Node** — polls a relayfile workspace for new filesystem events and emits them as n8n workflow triggers:

```
Config:
  Workspace ID: rw_karen_main
  Event Types:  created, updated, deleted
  Provider:     linear, github, notion
  Poll Interval: 30s

Output per event:
  eventId, type, path, revision, provider, correlationId, timestamp, nextCursor
```

This means n8n workflows can fire directly from relayfile events — without Karen needing to be in the loop for every event. Routine notifications (issue assigned → Slack DM, PR merged → update project tracker) run entirely in n8n automation.

**Relayfile Action Node** — seven operations Karen (or n8n) can invoke against the VFS:
- `Read File`, `Write File`, `Query Files`, `List Tree`
- `Bulk Write` — batch writeback for multiple integration updates
- `Get Events` — retrieve event history for a path
- `Export Workspace` — full workspace snapshot

**Relayfile Ops Node** — monitors the writeback pipeline:
- `List Operations`, `Get Operation`, `Replay Operation`
- Useful for n8n error-handling flows when writeback to Linear/GitHub fails

Example n8n workflow using the trigger:
```
[Relayfile Trigger: /github/repos/*/pulls CREATED]
  → [IF: pr.assignee == context.userId]
    → [HTTP: POST to Karen's inbox → Karen investigates]
  → [ELSE]
    → [Slack: notify team channel directly]
```

This offloads high-volume routing decisions from Karen to n8n, preserving Karen's token budget for decisions that actually need intelligence.

### 9.2 relaycast → n8n: `relaycast-n8n-bridge`

[`AgentWorkforce/relaycast-n8n-bridge`] runs as a lightweight daemon that subscribes to relaycast channels and forwards agent messages to n8n webhook URLs with exponential backoff retry.

**How it works:**

```
Karen/Sage/Ricky post a finding to a relaycast channel
  → bridge subscribes via glob pattern (e.g., "karen-findings/*")
  → 100ms queue batching to prevent webhook floods
  → HTTP POST to matched n8n webhook URL
  → retry on failure: 3 attempts, exponential backoff
```

**Message shape forwarded to n8n:**

```json
{
  "channel": "karen-findings/ricky-debug",
  "messageId": "msg_abc123",
  "sender": "ricky",
  "timestamp": "2026-05-17T09:14:00Z",
  "content": "...",
  "metadata": {
    "prNumber": 42,
    "filePaths": ["src/policy/index.ts"],
    "severity": "high",
    "agentRole": "workflow-debugger",
    "agentId": "ricky-v1"
  },
  "bridge": {
    "bridgeId": "openkaren-bridge",
    "routeRef": "ricky-findings",
    "processedAt": "2026-05-17T09:14:00Z"
  }
}
```

**n8n routing by severity:**

```
[Webhook Trigger: relaycast-bridge POST]
  → [Switch on $json.metadata.severity]
    → "critical" → [PagerDuty: open incident]
    → "high"     → [Slack: #incidents DM + Telegram to user]
    → "medium"   → [Jira: create ticket]
    → "low"      → [Slack: #general summary]
```

**Health endpoint:** `GET /health` exposes message counters, retry metrics, and per-route stats — feeds into the burn dashboard for operational visibility.

**Glob pattern routing config:**

```json
{
  "routes": [
    { "pattern": "karen-findings/*",    "webhook": "http://n8n:5678/webhook/karen-findings" },
    { "pattern": "ricky-debug/*",       "webhook": "http://n8n:5678/webhook/ricky-findings" },
    { "pattern": "sage-plans/*",        "webhook": "http://n8n:5678/webhook/sage-output" },
    { "pattern": "karen-proactive/*",   "webhook": "http://n8n:5678/webhook/proactive-surface" }
  ]
}
```

### 9.3 n8n → Karen: Inbox Surface

n8n's outbound flows POST back to Karen's `@agent-assistant/inbox` for anything that needs intelligence, not just routing:

```typescript
inbox.register({
  source: 'n8n',
  handler: async (event) => {
    const projection = await inbox.project({
      type: 'external-trigger',
      payload: event,
      surfaceId: 'telegram-primary',
    });
    await karen.proactiveReply(projection);
  },
});
```

Example flows that need Karen's intelligence (not just n8n routing):
- `"AWS billing alert fired → Karen investigates root cause, not just notifies"`
- `"Calendar event in 1 hour → Karen assembles context-aware prep brief"`
- `"GA4 daily summary → Karen synthesizes trends and flags anomalies"`

### 9.4 Full Event Flow Examples

**Scenario A: Linear issue assigned (routine — Karen not involved)**
```
Linear webhook → Nango → relayfile VFS update (/linear/issues/AGE-42)
  → n8n-nodes-relayfile Trigger fires
  → n8n IF: not assigned to user → Slack #team notification
  (Karen's budget untouched)
```

**Scenario B: GitHub PR opened on critical path (Karen involved)**
```
GitHub webhook → Nango → relayfile VFS update (/github/pulls/99)
  → n8n-nodes-relayfile Trigger fires
  → n8n IF: pr.base == 'main' && labels include 'critical'
  → POST to Karen's inbox
  → Karen reviews PR, surfaces blockers to user via Telegram
```

**Scenario C: Ricky finds a bug overnight (agent finding → downstream)**
```
Ricky posts finding to relaycast: "karen-findings/ricky-debug"
  → relaycast-n8n-bridge picks up (glob match)
  → metadata.severity == "high"
  → n8n: Slack #incidents + Telegram DM to user + Jira ticket created
  (Karen wakes up to a morning summary, Jira already filed)
```

**Scenario D: Sage completes a plan (structured output → downstream)**
```
Sage posts plan to relaycast: "sage-plans/architecture-review"
  → relaycast-n8n-bridge picks up
  → n8n: writes plan to Notion via relayfile Action Node
  → n8n: Slack notification to team
  → n8n: POSTs summary to Karen's inbox → Karen surfaces to user
```

---

## 11. Comparison: OpenKaren vs OpenClaw vs Hermes Agent

### Feature Matrix

| Property | OpenKaren | OpenClaw | Hermes Agent |
|---|---|---|---|
| **Token spend tracking** | Yes — burn attribution, budget gates, model downgrade | No | No |
| **Command compression** | Yes — rtk (60–90%) | No | No |
| **Structural code nav** | Yes — tilth (-40%) | No | No |
| **Semantic graph queries** | Yes — tokensave (93%) | No | No |
| **Budget-aware routing** | Yes — policy → routing tier | No | No |
| **Proactive scheduling** | Yes — relaycron | Partial — cron tool | No |
| **SaaS integration VFS** | Yes — relayfile | No | No |
| **Multi-agent delegation** | Yes — Sage, Ricky via relaycast | No | Subagent RPC |
| **Persistent learning** | Planned — skills package | Static SKILL.md | Yes (ungated) |
| **BYOH execution** | Yes — execution-adapter | No | Yes (7 backends) |
| **TypeScript SDK** | Yes | Partial | No (Python) |
| **Formal capability negotiation** | Yes — negotiate() | No | No |
| **Policy governance** | Yes — @agent-assistant/policy | Ad hoc config | No |
| **Voice integration** | No (v1) | Yes (macOS/iOS) | No |
| **Canvas** | No (v1) | Yes (A2UI) | No |
| **n8n bidirectional mesh** | Yes — relayfile→n8n + relaycast→n8n + n8n→Karen | No | No |
| **Slack surface** | Yes — native via agent-assistant/surfaces + Nango | Yes (daemon) | Yes (gateway) |
| **Cross-surface session bridge** | Yes — sessions package; Telegram ↔ Slack continuity | No | No |
| **Nango OAuth** | Yes — single flow covers surface + VFS + bridge | Manual channel config | No |
| **Fully local option** | Yes (Mac mini) | Yes | Yes |
| **Self-hosted** | Yes | Yes | Yes |
| **Telegram** | Yes | Yes | Yes |
| **Trace dashboard** | Yes — workshop | No | No |
| **Spend dashboard** | Yes — burn + rtk + tilth | No | No |

### Where OpenKaren Wins

**vs OpenClaw:**
- Token consciousness end-to-end (burn + rtk + tilth + tokensave) — OpenClaw has no awareness of spend
- Budget-gated routing — OpenClaw can't downgrade model based on budget
- relayfile SaaS VFS — OpenClaw has no structured integration filesystem
- Multi-agent delegation via relaycast — OpenClaw has session spawning but no specialist fabric
- TypeScript SDK — OpenClaw is a daemon, not an embeddable library
- Cross-surface session bridging — OpenClaw routes channels to agents but doesn't bridge session context across surfaces
- Nango single OAuth covers surface + VFS + bridge — OpenClaw requires manual channel configuration per platform

**vs Hermes Agent:**
- Token consciousness — Hermes has no burn, rtk, tilth, or tokensave equivalent
- Policy-gated budget enforcement — Hermes has no policy layer
- relayfile integration VFS — Hermes has tools, not a filesystem abstraction
- TypeScript purity — Hermes is 88% Python; Karen is TypeScript-native
- Formal capability negotiation — Hermes picks backends but doesn't negotiate capabilities
- Identity portable across execution backends — Hermes has no identity primitive above the harness

### Where OpenKaren Doesn't Win (Yet)

**vs OpenClaw:**
- Voice wake words — OpenClaw has native macOS/iOS voice; Karen v1 is text-only
- Canvas — OpenClaw has A2UI visual workspace; Karen v1 has none
- 20+ platform channels — OpenClaw integrates Discord, Signal, iMessage; Karen v1 is Telegram only

**vs Hermes:**
- Persistent learning loop — Hermes has autonomous skill creation; Karen's skills package is v2
- More execution backends — Hermes has 7 backends; Karen v1 ships BuiltIn + Claude API adapters
- Research infrastructure — Hermes has `trajectory_compressor.py` for training; Karen's trajectory → skill pipeline is v2

---

## 12. What Makes OpenKaren the Right Product

Neither OpenClaw nor Hermes tries to own the cost conversation. Both assume tokens are essentially free — OpenClaw because it's local-first and focused on privacy, Hermes because it's research-focused and optimizing for capability.

OpenKaren's bet is different: **the user paying $75/month cares deeply about what that $75 gets them.** They want to know their burn rate. They want to know Karen is not wasting tokens on bloated command output. They want the model to downgrade gracefully rather than surprise them with a $200 API bill.

Token consciousness is not a feature. It is the product philosophy.

Combined with proactive behavior (Karen watches your integrations and surfaces what matters before you ask), this creates an assistant that is:
- **Cheaper to run** than an unoptimized Claude API setup
- **More useful** than a reactive assistant
- **More trustworthy** than an autonomous agent with no budget governance

---

## 13. Implementation Roadmap

### Phase 0: Mac Mini Runtime (Week 1–2)

- [ ] Bootstrap `agent-assistant` SDK on Mac mini
- [ ] Stand up relayfile with docker-compose (Linear + GitHub providers)
- [ ] Configure relaycron with daily standup + weekly review schedules
- [ ] Install rtk Rust binary + configure bash hook
- [ ] Install tilth Rust binary + configure MCP server
- [ ] Install tokensave MCP server + index relayfile workspace
- [ ] Install workshop for local trace dashboard
- [ ] Configure Telegram surface (polling mode, no webhook required)
- [ ] Cloudflare Tunnel for external webhook reception (Slack events, Nango, Pipedream)
- [ ] Configure Nango Slack OAuth flow (single flow covers surface + relayfile + bridge)
- [ ] Configure Slack surface with thread-reply mode and channel allowlist
- [ ] Verify cross-surface session bridging: message on Telegram, continue on Slack

### Phase 1: Karen Persona + Token Consciousness (Week 2–3)

- [ ] Define `karen.persona.json` in workforce repo
- [ ] Wire burn stamping into Karen session start
- [ ] Add budget gate to `@agent-assistant/policy` (deny at 100%, downgrade at 75%)
- [ ] Add budget-aware routing tiers (opus → sonnet → haiku) to `@agent-assistant/routing`
- [ ] Wire rtk as tool wrapper in harness configuration
- [ ] Add `/spend` and `/forecast` Telegram commands
- [ ] Integration test: full turn with burn attribution + rtk compression

### Phase 2: Proactive Watches (Week 3–4)

- [ ] Wire relayfile watches for Linear issues, GitHub PRs, Notion pages
- [ ] Connect relaycron ticks to proactive engine in `@agent-assistant/proactive`
- [ ] Configure Telegram delivery for proactive messages
- [ ] Integration test: Linear issue created → Karen proactive message on Telegram

### Phase 3: Multi-Agent Delegation (Week 4–5)

- [ ] Configure relaycast channels (local daemon)
- [ ] Register Sage as specialist in `@agent-assistant/coordination`
- [ ] Register Ricky as specialist in `@agent-assistant/coordination`
- [ ] Wire Ricky's workflow monitoring to relaycron health-check schedule
- [ ] Integration test: complex planning request → delegation to Sage → synthesis → delivery

### Phase 4: Relay ↔ n8n Automation Mesh (Week 5–6)

- [ ] Install `n8n-nodes-relayfile` package in self-hosted n8n instance
- [ ] Configure Relayfile Trigger Node: watch `/linear/issues`, `/github/repos/*/pulls`, `/notion/pages`
- [ ] Build n8n routing workflows: severity-based Switch → Slack / Jira / Karen inbox
- [ ] Stand up `relaycast-n8n-bridge` daemon with glob routes for `karen-findings/*`, `ricky-debug/*`, `sage-plans/*`
- [ ] Configure Nango for OAuth management (Linear, GitHub, Notion, Slack)
- [ ] Wire Composio tools through `@agent-assistant/inbox`
- [ ] Wire Pipedream webhooks through `@agent-assistant/inbox`
- [ ] Integration test A: Linear issue created → relayfile event → n8n trigger → Slack (Karen budget untouched)
- [ ] Integration test B: Ricky finding → relaycast → bridge → n8n → PagerDuty + Jira + Telegram
- [ ] Integration test C: n8n calendar trigger → Karen inbox → prep brief → Telegram delivery
- [ ] Integration test D: Sage plan → relaycast → bridge → n8n → Notion write via Relayfile Action Node

### Phase 5: BYOK + Subscription (Week 6–7)

- [ ] Wire Relay BYOK key management for Anthropic API
- [ ] Add subscription check to session start policy gate
- [ ] Build spend summary dashboard (burn + rtk + tilth metrics combined)
- [ ] Integration test: full monthly budget cycle with spend reporting

---

## Appendix A: Local Port Map (Mac Mini)

| Service | Port | Notes |
|---|---|---|
| relayfile server | 9090 | Go VFS API |
| relayauth (dev) | 9091 | Dev token issuer |
| relaycron | 4007 | Scheduler API |
| relaycast local | 7528 | Agent messaging daemon |
| workshop | 5899 | Trace dashboard UI |
| n8n | 5678 | Automation UI |
| relaycast-n8n-bridge | 3721 | Bridge daemon + /health endpoint |
| tokensave MCP | stdio | MCP server via subprocess |
| tilth MCP | stdio | MCP server via subprocess |
| Cloudflare Tunnel | — | Routes external webhooks to localhost |

---

## Appendix B: Token Savings Projection

For a user running Karen 8 hours/day on active tasks:

| Layer | Mechanism | Expected Savings |
|---|---|---|
| RTK | Command output compression | 60–90% on bash/tool outputs |
| Tilth | Structural code navigation | ~40% on file reads |
| TokenSave | Semantic graph queries | ~93% on codebase retrieval |
| Budget routing | Haiku for simple turns | ~80% cost reduction on downgraded turns |
| Proactive filtering | Only surface relevant info | Fewer reactive deep turns |

A user paying $50/month in raw Anthropic API costs without Karen might pay $20–30/month with Karen's token consciousness stack active — while getting better coverage through proactive triggers.

---

## Appendix C: Governing Principles

1. **Product identity is canonical.** Karen is Karen regardless of which execution backend is selected.
2. **Execution harnesses are replaceable.** Opus today, Haiku tomorrow when budget tightens.
3. **Learning is policy-gated.** No skill promotes without explicit approval.
4. **Token spend is visible and bounded.** No surprises. Every dollar attributed.
5. **Proactive beats reactive.** Karen surfaces what matters before being asked.
6. **Platform reach is surface adapters.** No separate daemon. Telegram is a surfaces implementation.
