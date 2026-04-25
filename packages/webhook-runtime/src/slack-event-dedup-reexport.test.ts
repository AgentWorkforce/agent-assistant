import { describe, expect, it } from "vitest";

import {
  SlackEventDedupGate,
  getSlackDeduplicationKey,
  type SlackEventDedupStore,
} from "./index.js";
import * as surfaces from "@agent-assistant/surfaces";

function createMemoryStore(): SlackEventDedupStore & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    async hasBeenProcessed(key) {
      return keys.has(key);
    },
    async markProcessed(key, ttlSeconds) {
      keys.set(key, ttlSeconds);
    },
  };
}

describe("webhook-runtime re-exports SlackEventDedupGate from @agent-assistant/surfaces", () => {
  it("exposes the canonical SlackEventDedupGate class identity (no fork)", () => {
    expect(SlackEventDedupGate).toBe(surfaces.SlackEventDedupGate);
    expect(getSlackDeduplicationKey).toBe(surfaces.getSlackDeduplicationKey);
  });

  it("derives a dedup key from event_id, falling back to ts, then undefined", () => {
    expect(getSlackDeduplicationKey({ eventId: "Ev123", ts: "1700.0001" })).toBe(
      "Ev123",
    );
    expect(getSlackDeduplicationKey({ ts: "1700.0001" })).toBe("1700.0001");
    expect(getSlackDeduplicationKey({})).toBeUndefined();
    expect(getSlackDeduplicationKey({ eventId: "" })).toBeUndefined();
  });

  it("claims a dedup slot once and reports duplicates on retry", async () => {
    const store = createMemoryStore();
    const gate = new SlackEventDedupGate({ store, ttlSeconds: 60 });

    const first = await gate.claim({ eventId: "Ev_first" });
    expect(first).toEqual({ proceed: true, key: "Ev_first" });
    expect(store.keys.get("Ev_first")).toBe(60);

    const second = await gate.claim({ eventId: "Ev_first" });
    expect(second).toEqual({
      proceed: false,
      reason: "duplicate-event",
      key: "Ev_first",
    });
  });

  it("lets events without a dedup key proceed and reports the no-dedup-key reason", async () => {
    const store = createMemoryStore();
    const gate = new SlackEventDedupGate({ store });

    const decision = await gate.claim({});
    expect(decision).toEqual({ proceed: true, reason: "no-dedup-key" });
    expect(store.keys.size).toBe(0);
  });

  it("defaults the dedup TTL to SlackEventDedupGate.DEFAULT_TTL_SECONDS when omitted", async () => {
    const store = createMemoryStore();
    const gate = new SlackEventDedupGate({ store });

    await gate.claim({ eventId: "Ev_default_ttl" });
    expect(store.keys.get("Ev_default_ttl")).toBe(
      SlackEventDedupGate.DEFAULT_TTL_SECONDS,
    );
  });
});
