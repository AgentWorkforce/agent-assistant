// Fixture copied from sage/personas/*/persona.json @ 2026-05-23; refresh if those JSONs change.
import { describe, expect, it } from "vitest";
import type { PersonaDefinition } from "./index.js";

describe("canonical sage personas", () => {
  it("constructs morning-briefing", () => {
    const persona = {
      $schema: "https://schemas.agent-assistant.dev/persona/0.1.0/persona.schema.json",
      id: "sage:morning-briefing",
      intent: "morning-briefing",
      description:
        "Generates and DMs a daily morning briefing summarizing prior-day delivery, today's commitments, and at-risk threads.",
      tags: ["proactive", "daily-digest", "sage"],
      cloud: true,
      useSubscription: true,
      ownerService: "sage",
      schedules: [
        {
          name: "morning",
          cron: "0 7 * * *",
          tz: "America/Los_Angeles",
        },
      ],
      integrations: {
        github: {},
        linear: {},
        notion: {},
        slack: {},
      },
      mount: {
        enabled: false,
      },
      executor: {
        kind: "http-delegate",
        router: {
          kind: "workerd-service",
          url: "https://sage.agentrelay.com/api/proactive/dispatch",
          auth: {
            kind: "shared-secret",
            envVar: "SAGE_CLOUD_API_TOKEN",
          },
          timeoutSeconds: 25,
          healthcheck: "/api/proactive/health",
        },
      },
      memory: {
        enabled: true,
        backend: "supermemory",
      },
      delivery: [
        {
          kind: "slack-dm",
          configEnv: "BRIEFING_SLACK_USER",
        },
      ],
    } satisfies PersonaDefinition;

    expect(persona.id).toBe("sage:morning-briefing");
    expect(persona.executor.kind).toBe("http-delegate");
    expect(persona.intent).toBe("morning-briefing");
  });

  it("constructs follow-up-sweep", () => {
    const persona = {
      $schema: "https://schemas.agent-assistant.dev/persona/0.1.0/persona.schema.json",
      id: "sage:follow-up-sweep",
      intent: "follow-up-sweep",
      description:
        "Sweeps open follow-up commitments, evaluates evidence sources, and posts status updates or closes threads when the close-signal detector fires.",
      tags: ["proactive", "follow-up", "sage"],
      cloud: true,
      useSubscription: true,
      ownerService: "sage",
      schedules: [
        {
          name: "sweep",
          cron: "*/15 * * * *",
          tz: "UTC",
        },
      ],
      integrations: {
        github: {},
        linear: {},
        slack: {},
      },
      mount: {
        enabled: false,
      },
      executor: {
        kind: "http-delegate",
        router: {
          kind: "workerd-service",
          url: "https://sage.agentrelay.com/api/proactive/dispatch",
          auth: {
            kind: "shared-secret",
            envVar: "SAGE_CLOUD_API_TOKEN",
          },
          timeoutSeconds: 25,
          healthcheck: "/api/proactive/health",
        },
      },
      memory: {
        enabled: true,
        backend: "supermemory",
      },
      delivery: [
        {
          kind: "slack-post",
        },
      ],
    } satisfies PersonaDefinition;

    expect(persona.id).toBe("sage:follow-up-sweep");
    expect(persona.executor.kind).toBe("http-delegate");
    expect(persona.intent).toBe("follow-up-sweep");
  });

  it("constructs pr-matcher", () => {
    const persona = {
      $schema: "https://schemas.agent-assistant.dev/persona/0.1.0/persona.schema.json",
      id: "sage:pr-matcher",
      intent: "pr-matcher",
      description:
        "Correlates GitHub PR events with open follow-up threads to mark commitments delivered when the matching PR merges.",
      tags: ["proactive", "pr-matching", "sage"],
      cloud: true,
      useSubscription: true,
      ownerService: "sage",
      integrations: {
        github: {
          triggers: [
            {
              on: "pull_request",
            },
            {
              on: "pull_request_review",
            },
          ],
        },
        slack: {},
      },
      mount: {
        enabled: false,
      },
      executor: {
        kind: "http-delegate",
        router: {
          kind: "workerd-service",
          url: "https://sage.agentrelay.com/api/proactive/dispatch",
          auth: {
            kind: "shared-secret",
            envVar: "SAGE_CLOUD_API_TOKEN",
          },
          timeoutSeconds: 25,
          healthcheck: "/api/proactive/health",
        },
      },
      memory: {
        enabled: true,
        backend: "supermemory",
      },
      delivery: [
        {
          kind: "slack-post",
        },
      ],
    } satisfies PersonaDefinition;

    expect(persona.id).toBe("sage:pr-matcher");
    expect(persona.executor.kind).toBe("http-delegate");
    expect(persona.intent).toBe("pr-matcher");
  });

  it("constructs stale-threads", () => {
    const persona = {
      $schema: "https://schemas.agent-assistant.dev/persona/0.1.0/persona.schema.json",
      id: "sage:stale-threads",
      intent: "stale-threads",
      description:
        "Detects threads that have gone silent past their commitment SLA and surfaces them for owner attention.",
      tags: ["proactive", "stale-detection", "sage"],
      cloud: true,
      useSubscription: true,
      ownerService: "sage",
      schedules: [
        {
          name: "scan",
          cron: "0 */12 * * *",
          tz: "UTC",
        },
      ],
      integrations: {
        github: {},
        linear: {},
        slack: {},
      },
      mount: {
        enabled: false,
      },
      executor: {
        kind: "http-delegate",
        router: {
          kind: "workerd-service",
          url: "https://sage.agentrelay.com/api/proactive/dispatch",
          auth: {
            kind: "shared-secret",
            envVar: "SAGE_CLOUD_API_TOKEN",
          },
          timeoutSeconds: 25,
          healthcheck: "/api/proactive/health",
        },
      },
      memory: {
        enabled: true,
        backend: "supermemory",
      },
      delivery: [
        {
          kind: "slack-post",
        },
      ],
    } satisfies PersonaDefinition;

    expect(persona.id).toBe("sage:stale-threads");
    expect(persona.executor.kind).toBe("http-delegate");
    expect(persona.intent).toBe("stale-threads");
  });
});
