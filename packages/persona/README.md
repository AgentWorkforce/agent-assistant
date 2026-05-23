# @agent-assistant/persona

`@agent-assistant/persona` owns the shared `PersonaDefinition` contract used to register proactive assistants across Agent Workforce services. Version 0.5.0 follows the full canonical persona schema from [Sage proactive unification §6](https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#6-persona-schema), including separate `schedules`, `inbox`, `integrations`, top-level `watch`, `mount`, and ephemeral-sandbox runtime fields.

Use this package for type-only persona declarations before handing them to a dispatcher, registry, or deployment workflow. The schema keeps executor choice explicit (`ephemeral-sandbox`, `http-delegate`, or `hybrid`) while preserving optional memory and delivery settings for consumers that need them. 0.5.0 is a breaking change vs. 0.4.35; see `CHANGELOG.md` for the migration table.

```ts
import type { PersonaDefinition } from "@agent-assistant/persona";

export const morningBriefingPersona = {
  id: "sage:morning-briefing",
  intent: "Prepare a daily briefing from workspace activity",
  description: "Runs on a weekday schedule.",
  schedules: [
    {
      name: "weekday-morning",
      cron: "0 8 * * 1-5",
      tz: "America/Los_Angeles",
    },
  ],
  executor: {
    kind: "ephemeral-sandbox",
  },
  onEvent: "./src/personas/morning-briefing.ts",
  harness: "codex",
  model: "gpt-5.4",
  systemPrompt: "Prepare a concise daily briefing.",
  harnessSettings: {
    reasoning: "medium",
    timeoutSeconds: 900,
  },
  inputs: {
    lookbackHours: {
      type: "number",
      description: "Hours of activity to summarize.",
      required: true,
      default: 24,
    },
  },
} satisfies PersonaDefinition;
```
