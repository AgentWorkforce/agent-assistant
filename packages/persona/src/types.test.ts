import { describe, expect, it } from "vitest";
import type { PersonaDefinition } from "./types.js";

describe("persona type contracts", () => {
  it("supports ephemeral sandbox executors", () => {
    const persona = {
      id: "daily-research",
      displayName: "Daily Research",
      version: "0.1.0",
      ownerService: "sage",
      executor: { kind: "ephemeral-sandbox" },
      triggers: [{ kind: "cron", cron: "0 9 * * *", timezone: "UTC" }],
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("ephemeral-sandbox");
  });

  it("supports HTTP delegate executors", () => {
    const persona = {
      id: "nightcto-triage",
      displayName: "NightCTO Triage",
      version: "0.1.0",
      ownerService: "nightcto",
      executor: {
        kind: "http-delegate",
        router: {
          endpoint: "https://example.com/personas/nightcto",
          method: "POST",
          timeoutMs: 30_000,
          headers: { "x-persona": "nightcto" },
        },
      },
      triggers: [{ kind: "webhook", provider: "github", event: "issue.opened" }],
      delivery: { mode: "callback", callbackUrl: "https://example.com/callback" },
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("http-delegate");
  });

  it("supports hybrid executors", () => {
    const persona = {
      id: "msd-app-helper",
      displayName: "MSD App Helper",
      version: "0.1.0",
      ownerService: "msd-app",
      executor: {
        kind: "hybrid",
        router: {
          endpoint: "https://example.com/personas/msd",
        },
        sandbox: {
          snapshot: "persona-msd-base",
          lifecycle: "warm-pool",
          ttlSeconds: 600,
          maxConcurrentBorrows: 3,
          capabilities: ["repo-read", "browser"],
        },
      },
      triggers: [{ kind: "inbox", channel: "support", event: "message.created" }],
      memory: { backend: "agent-memory", namespace: "msd-app" },
      metadata: { tier: "support" },
    } satisfies PersonaDefinition;

    expect(persona.executor.kind).toBe("hybrid");
  });
});
