# Changelog

All notable changes to `@agent-assistant/persona` are documented in this file.

This package follows [Semantic Versioning](https://semver.org/). The schema this
package types is defined in the canonical multi-repo spec:
https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#6-persona-schema

## 0.5.0 — BREAKING

Full §6 schema. This release replaces the reduced schema that shipped as
`0.4.35` from the `ricky/sage-214-pr01a-persona-types` branch.

### Migration from 0.4.35

- `triggers: PersonaTrigger[]` removed. Use separate `schedules: PersonaSchedule[]`
  (cron triggers) and `inbox: InboxTrigger[]` (chat/message triggers). Webhook
  triggers move into `integrations[provider].triggers[]`.
- `displayName`, `version`, `sourceTag`, `metadata` removed. `intent` (string)
  takes their place for human display; `tags?: string[]` for tagging.
- Added: `cloud?: boolean`, `useSubscription?: boolean`, `tags?`, `integrations?`,
  `watch?`, `mount?`, `onEvent?`, `harness?`, `model?`, `systemPrompt?`,
  `harnessSettings?`, and `inputs?`. See canonical spec §6.

### Changed (tightened constraints)

- `description` is now **required** (`description: string`). It was optional
  in 0.4.35; persona definitions that omitted it will fail to type-check
  under 0.5.0.
- `delivery` cardinality: single object → array. The old
  `delivery?: PersonaDeliveryConfig` becomes `delivery?: DeliveryChannel[]`,
  so a persona can declare multiple sinks. Wrap existing single configs as
  `delivery: [...]` and translate fields to the `DeliveryChannel` shape
  (`kind`, `target`, `configEnv`).
- `memory` shape changed. The old `memory?: PersonaMemoryConfig` becomes
  `memory?: MemoryConfig`; add the required `enabled` boolean and migrate
  `namespace` to `scopes` when the old namespace partitioned memory.
- `executor` keeps the same top-level `kind` values, but nested router and
  hybrid sandbox configs are breaking changes. Routers now require `kind` and
  `url` (`endpoint` was renamed), use `timeoutSeconds` instead of `timeoutMs`,
  and expose `auth`/`healthcheck` instead of method/header fields. Hybrid
  sandboxes now require `lifecycle`, `borrowProtocol: "v1"`, and
  `maxConcurrentBorrows`; `ttlSeconds` should be translated to
  `idleStopMinutes` where applicable.
- `inbox` entries now require `pattern` and restrict `source` to
  `"relaycast" | "slack" | "discord"`.
- `watch.events` is required and restricted to `"created" | "updated" | "deleted"`.
- `memory.backend`, `delivery.kind`, and router `kind`/`auth.kind` are restricted
  to the canonical literals from §6.

### Old → new field map

| 0.4.35 field                       | 0.5.0 replacement                                           |
|------------------------------------|-------------------------------------------------------------|
| `triggers[]` (cron variant)        | `schedules: PersonaSchedule[]`                              |
| `triggers[]` (chat/message)        | `inbox: InboxTrigger[]`                                     |
| `triggers[]` (webhook)             | `integrations[provider].triggers[]`                         |
| `displayName`                      | `intent` (string, human-readable purpose)                   |
| `version`                          | removed (package version is the source of truth)            |
| `sourceTag`                        | `tags?: string[]`                                           |
| `metadata`                         | removed (use `intent` + `tags` + `integrations` instead)    |
| `description?` (optional)          | `description` (now **required**)                            |
| `executor.router.endpoint`         | `executor.router.url` + required `executor.router.kind`      |
| `executor.router.timeoutMs`        | `executor.router.timeoutSeconds`                             |
| `triggers[]` inbox channel/event   | `inbox[]` entries with `source` + `pattern`                  |
| `executor.sandbox.lifecycle?`      | `executor.sandbox.lifecycle` (now **required**)              |
| `executor.sandbox.ttlSeconds`      | `executor.sandbox.idleStopMinutes`                           |
| `executor.sandbox.maxConcurrentBorrows?` | `executor.sandbox.maxConcurrentBorrows` (now **required**) |
| —                                  | `executor.sandbox.borrowProtocol: "v1"` (added for hybrid)  |
| `memory: PersonaMemoryConfig`      | `memory: MemoryConfig` (`enabled` required; `namespace` → `scopes`) |
| `delivery: PersonaDeliveryConfig`  | `delivery: DeliveryChannel[]` (single → array)              |
| —                                  | `cloud?: boolean` (added)                                   |
| —                                  | `useSubscription?: boolean` (added)                         |
| —                                  | `integrations?: Record<string, IntegrationDecl>` (added)    |
| —                                  | `watch?: WatchRule[]` (added)                               |
| —                                  | `mount?: PersonaMount` (added)                              |
| —                                  | ephemeral fields: `onEvent?`, `harness?`, `model?`, `systemPrompt?`, `harnessSettings?`, `inputs?` |

Required exports in this release: `PersonaDefinition`, `PersonaExecutor`,
`RouterConfig`, `SandboxBorrowConfig`, `PersonaSchedule`, `InboxTrigger`,
`IntegrationDecl`, `WatchRule`, `PersonaMount`, `MemoryConfig`, `DeliveryChannel`,
`HarnessSettings`, `InputDecl`, `PERSONA_SCHEMA_URL`.

Downstream repos consuming this version should drop their local `persona-types`
mirrors (sage PR #214 follow-up; workforce#130 follow-up) and depend on
`@agent-assistant/persona@^0.5.0`.
