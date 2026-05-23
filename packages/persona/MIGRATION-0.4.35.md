# Migrating `@agent-assistant/persona` 0.4.35 to 0.5.0

Version 0.5.0 replaces the reduced 0.4.35 preview schema with the full
canonical persona schema from Sage proactive unification section 6:
https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#6-persona-schema

The design mismatch is called out in section 16.2 of the same canonical spec.
Downstream repos pinned to `^0.4.35` should migrate before dropping local
persona-type mirrors.

## Field Map

| 0.4.35 field | 0.5.0 location |
| --- | --- |
| `id` | `id` |
| `displayName` | `intent` |
| `version` | Remove from the persona definition; use the package version as the contract version. |
| `description` | `description` (now **required**; was optional in 0.4.35) |
| `ownerService` | `ownerService` |
| `sourceTag` | `tags?: string[]`, or fold into `intent` when it is descriptive. |
| `executor` | `executor` (top-level discriminator values are retained, but nested `router` and `sandbox` shapes changed; see tightened constraints below) |
| `triggers[]` with `kind: "cron"` | `schedules[]` |
| `triggers[]` with `kind: "inbox"` | `inbox[]` |
| `triggers[]` with `kind: "webhook"` | `integrations[provider].triggers[]` |
| `memory: PersonaMemoryConfig` | `memory: MemoryConfig` (`enabled` is now required; migrate `namespace` to `scopes`) |
| `delivery: PersonaDeliveryConfig` | `delivery: DeliveryChannel[]` (cardinality change: single object → array of channels) |
| `metadata` | Prefer `tags`, `intent`, and provider-specific `integrations` config. |

## New Fields

| 0.5.0 field | When to use it |
| --- | --- |
| `tags?: string[]` | Discovery labels, former `sourceTag` values, or coarse metadata. |
| `cloud?: boolean` | The persona is intended to run in hosted/cloud infrastructure. |
| `useSubscription?: boolean` | The persona consumes subscription-backed activity. |
| `integrations?: Record<string, IntegrationDecl>` | Provider triggers, provider config, and `scopes`. |
| `watch?: WatchRule[]` | Resource or path watch rules. Requires downstream workforce#130 support. |
| `mount?: PersonaMount` | Mount policy for watched or borrowed state. Requires downstream workforce#130 support. |
| `onEvent?`, `harness?`, `model?`, `systemPrompt?`, `harnessSettings?`, `inputs?` | Ephemeral-sandbox runtime entry point, harness choice, prompt, model, and typed handler inputs. |

## Tightened Constraints

The field-name map above hides several shape changes that will break downstream
consumers even when the field name is unchanged:

- **`description` is now required.** In 0.4.35 this field was optional
  (`description?: string`). In 0.5.0 it is required (`description: string`).
  Any 0.4.35 persona definitions that omit `description` will fail to
  type-check under 0.5.0; supply a description before upgrading.
- **`delivery` is now an array.** In 0.4.35 it was a single
  `PersonaDeliveryConfig` object. In 0.5.0 it is `DeliveryChannel[]`, so a
  persona can declare multiple delivery sinks. Wrap your existing single
  config in an array (`delivery: [old]`) and translate the field names per
  the `DeliveryChannel` type (`kind`, `target`, `configEnv`).
- **`memory` requires an explicit enablement flag.** In 0.4.35,
  `PersonaMemoryConfig` only exposed `backend?` and `namespace?`. In 0.5.0,
  `MemoryConfig.enabled` is required, `backend` accepts the backend identifier
  string, and the old single `namespace` should become `scopes: [namespace]`
  when the namespace was used to partition memory.
- **`executor` keeps its top-level `kind` values, but nested contracts changed.**
  Existing `http-delegate` and `hybrid` executors need their router config
  migrated, and `hybrid` executors also need the new sandbox borrow fields.

  | 0.4.35 nested field | 0.5.0 nested field |
  | --- | --- |
  | `router.endpoint` | `router.url` |
  | `router.timeoutMs` | `router.timeoutSeconds` (convert milliseconds to seconds) |
  | `router.method` | Removed; 0.5.0 does not model an HTTP method here. |
  | `router.headers` | Use `router.auth` for shared-secret auth or move provider-specific headers into integration config. |
  | — | Add required `router.kind` (for example, `"workerd-service"`). |
  | — | Add required `router.auth` with `kind: "shared-secret"` and `envVar`. |
  | `sandbox.lifecycle?` | `sandbox.lifecycle` is now required (`"warm-pool"` or `"ephemeral"`). |
  | `sandbox.ttlSeconds` | Use `sandbox.idleStopMinutes` when modeling warm-pool idle shutdown. |
  | `sandbox.capabilities` | Removed from `SandboxBorrowConfig`; model capabilities outside persona schema if still needed. |
  | — | Add required `sandbox.borrowProtocol: "v1"`. |
  | `sandbox.maxConcurrentBorrows?` | `sandbox.maxConcurrentBorrows` is now required. |
- **`inbox` entries require `pattern`.** Convert old channel/event filters into a
  single canonical pattern such as `"#sage"`, `"@self"`, a channel id, or a user id.
- **`watch.events` is required.** Use only `"created"`, `"updated"`, and
  `"deleted"` event values.

## Trigger Migration

Split the old collapsed `triggers[]` array by trigger kind.

```ts
const oldTriggers = [
  { kind: "cron", cron: "0 8 * * 1-5", timezone: "America/Los_Angeles", name: "weekday" },
  { kind: "inbox", channel: "slack", event: "app_mention" },
  { kind: "webhook", provider: "github", event: "pull_request.opened" },
];

const newTriggers = {
  schedules: [{ name: "weekday", cron: "0 8 * * 1-5", tz: "America/Los_Angeles" }],
  inbox: [{ source: "slack", pattern: "@self" }],
  integrations: {
    github: {
      triggers: [{ on: "pull_request.opened" }],
      scopes: ["pull_request:read"],
    },
  },
};
```

## Worked Example

0.4.35:

```ts
import type { PersonaDefinition } from "@agent-assistant/persona";

export const morningBriefing = {
  id: "morning-briefing",
  displayName: "Morning briefing",
  version: "0.4.35",
  description: "Summarize workspace activity each weekday morning.",
  ownerService: "sage",
  sourceTag: "sage",
  executor: {
    kind: "http-delegate",
    router: {
      endpoint: "https://sage.example.com/personas/morning-briefing",
      method: "POST",
      timeoutMs: 30000,
    },
  },
  triggers: [
    { kind: "cron", name: "weekday", cron: "0 8 * * 1-5", timezone: "America/Los_Angeles" },
    { kind: "inbox", channel: "slack", event: "app_mention" },
    { kind: "webhook", provider: "github", event: "pull_request.opened" },
  ],
  memory: { backend: "supermemory", namespace: "sage" },
  delivery: { mode: "callback", callbackUrl: "https://sage.example.com/callbacks/persona" },
  metadata: { team: "sage", priority: "daily" },
} satisfies PersonaDefinition;
```

0.5.0:

```ts
import type { PersonaDefinition } from "@agent-assistant/persona";

export const morningBriefing = {
  id: "morning-briefing",
  intent: "Prepare a weekday morning briefing from workspace activity.",
  description: "Summarize workspace activity each weekday morning.",
  ownerService: "sage",
  tags: ["sage", "daily", "priority:daily"],
  cloud: true,
  useSubscription: true,
  executor: {
    kind: "http-delegate",
    router: {
      kind: "workerd-service",
      url: "https://sage.example.com/personas/morning-briefing",
      auth: {
        kind: "shared-secret",
        envVar: "SAGE_CLOUD_API_TOKEN",
      },
      timeoutSeconds: 30,
    },
  },
  schedules: [{ name: "weekday", cron: "0 8 * * 1-5", tz: "America/Los_Angeles" }],
  inbox: [{ source: "slack", pattern: "@self" }],
  integrations: {
    github: {
      triggers: [{ on: "pull_request.opened" }],
      scopes: ["pull_request:read"],
    },
  },
  watch: [
    {
      paths: ["/integrations/github/repos/*/pulls/*.json"],
      events: ["created", "updated"],
      debounceMs: 5000,
    },
  ],
  mount: {
    enabled: true,
    ignoredPatterns: ["node_modules/", ".git/"],
    readonlyPatterns: ["/integrations/**"],
  },
  memory: {
    enabled: true,
    backend: "supermemory",
    scopes: ["sage"],
  },
  delivery: [
    {
      kind: "slack-dm",
      configEnv: "SAGE_BRIEFING_SLACK_USER",
    },
  ],
} satisfies PersonaDefinition;
```

## Notes for Downstream Repos

Sage and workforce/persona-kit consumers should replace local 0.4.35-shaped
mirrors with imports from `@agent-assistant/persona@^0.5.0` after the sibling
0.5.0 schema package lands. Webhook permissions should move into
`integrations[provider].scopes`, and any old metadata that controlled discovery
or routing should become explicit `tags`, `intent`, `watch`, or `mount` fields.
