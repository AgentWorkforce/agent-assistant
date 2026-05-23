import { describe, expect, it } from "vitest";
import type {
  HarnessSettings,
  InboxTrigger,
  InputDecl,
  IntegrationDecl,
  PersonaDefinition,
  PersonaMount,
  PersonaSchedule,
  WatchRule,
} from "./types.js";
import { PERSONA_SCHEMA_URL } from "./index.js";

describe("persona section 6 schema contracts", () => {
  it("constructs an ephemeral-sandbox persona with the full schema", () => {
    const persona = {
      id: "daily-research",
      intent: "Summarize overnight research notes each morning.",
      description: "Daily research briefing generated from recent notes.",
      tags: ["daily", "research"],
      executor: { kind: "ephemeral-sandbox" },
      schedules: [
        { name: "morning", cron: "0 9 * * *", tz: "UTC" },
      ] satisfies PersonaSchedule[],
      memory: {
        enabled: true,
        backend: "agent-memory",
        scopes: ["daily-research"],
        ttlDays: 30,
      },
      delivery: [{ kind: "slack-post", target: "#research" }],
      onEvent: "./src/personas/daily-research.ts",
      harness: "codex",
      model: "gpt-5.4",
      systemPrompt: "Prepare concise research briefings from workspace activity.",
      harnessSettings: {
        reasoning: "medium",
        timeoutSeconds: 900,
      } satisfies HarnessSettings,
      inputs: {
        lookbackHours: {
          type: "number",
          description: "How many hours of activity to summarize.",
          required: true,
          default: 24,
        },
      } satisfies Record<string, InputDecl>,
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("ephemeral-sandbox");
    expect(persona.inputs?.lookbackHours?.required).toBe(true);
  });

  it("constructs an http-delegate persona with integration scopes", () => {
    const persona = {
      id: "pr-matcher",
      intent: "Match incoming PRs to reviewers.",
      description: "Delegates pull request matching to an HTTP router.",
      executor: {
        kind: "http-delegate",
        router: {
          kind: "workerd-service",
          url: "https://example.com/personas/pr-matcher",
          timeoutSeconds: 30,
          auth: { kind: "shared-secret", envVar: "PR_MATCHER_SECRET" },
        },
      },
      integrations: {
        github: {
          scopes: ["repo:read", "pull_requests:write"],
          triggers: [{ on: "pull_request.opened" }],
        },
      } satisfies Record<string, IntegrationDecl>,
      inbox: [{ source: "slack", pattern: "#pr-review" }] satisfies InboxTrigger[],
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("http-delegate");
    expect(persona.integrations?.github?.scopes).toContain("repo:read");
    expect(persona.inbox?.[0]?.pattern).toBe("#pr-review");
  });

  it("constructs a hybrid persona with watch rules and mount config", () => {
    const persona = {
      id: "stale-threads",
      intent: "Sweep stale Slack threads.",
      description: "Hybrid persona that watches support files and borrows a sandbox.",
      cloud: true,
      useSubscription: true,
      executor: {
        kind: "hybrid",
        router: {
          kind: "workerd-service",
          url: "https://example.com/personas/stale-threads",
          auth: { kind: "shared-secret", envVar: "STALE_THREADS_SECRET" },
          timeoutSeconds: 30,
          healthcheck: "/healthz",
        },
        sandbox: {
          snapshot: "persona-stale-base",
          lifecycle: "warm-pool",
          borrowProtocol: "v1",
          maxConcurrentBorrows: 3,
          reuseLabels: ["persona:stale-threads"],
          idleStopMinutes: 10,
        },
      },
      watch: [
        {
          paths: ["/support/**/*.md"],
          events: ["updated"],
          debounceMs: 500,
          match: "stale",
        },
      ] satisfies WatchRule[],
      mount: {
        enabled: true,
        readonlyPatterns: ["support/archive/**"],
      } satisfies PersonaMount,
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("hybrid");
    expect(persona.watch?.length).toBe(1);
    expect(persona.mount?.readonlyPatterns).toContain("support/archive/**");
  });

  it("accepts a minimal cron-only persona", () => {
    const persona = {
      id: "minimal-cron",
      intent: "Smallest legal scheduled persona.",
      description: "Runs on a cron schedule without optional integrations.",
      executor: { kind: "ephemeral-sandbox" },
      schedules: [{ name: "quarter-hour", cron: "*/15 * * * *", tz: "UTC" }],
    } satisfies PersonaDefinition;

    expect(persona.schedules?.[0]?.cron).toBe("*/15 * * * *");
  });

  it("exposes PERSONA_SCHEMA_URL", () => {
    expect(typeof PERSONA_SCHEMA_URL).toBe("string");
    expect(PERSONA_SCHEMA_URL.length).toBeGreaterThan(0);
  });
});

// @ts-expect-error "change" is not a canonical watch event.
const invalidWatchEvent = { paths: ["/support/**/*.md"], events: ["change"] } satisfies WatchRule;

// @ts-expect-error watch rules must declare the event kinds they listen for.
const missingWatchEvents = { paths: ["/support/**/*.md"] } satisfies WatchRule;

// @ts-expect-error inbox triggers require a canonical pattern, not arbitrary filters.
const invalidInboxTrigger = { source: "slack", filter: { channel: "pr-review" } } satisfies InboxTrigger;
