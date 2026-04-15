import { describe, it, expect } from "vitest";

import {
  SlackThreadGate,
  type ActiveThreadKey,
  type ActiveThreadStore,
} from "./slack-thread-gate.js";

function keyString(key: ActiveThreadKey): string {
  return `${key.workspaceId}:${key.channel}:${key.threadTs}`;
}

function createFakeStore() {
  const entries = new Map<string, { key: ActiveThreadKey; ttl: number }>();
  const store: ActiveThreadStore = {
    async isActive(key) {
      return entries.has(keyString(key));
    },
    async markActive(key, ttl) {
      entries.set(keyString(key), { key, ttl });
    },
  };
  return { store, entries };
}

describe("SlackThreadGate.shouldProcess", () => {
  it("allows mention events regardless of store state", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess(
      { type: "mention", channel: "C1", ts: "100.1" },
      "W1",
    );
    expect(decision.proceed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("drops message events with threadTs when the thread is inactive", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess(
      { type: "message", channel: "C1", threadTs: "100.1", ts: "100.2" },
      "W1",
    );
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toBe("inactive-thread");
  });

  it("allows message events with threadTs when the thread is active", async () => {
    const { store, entries } = createFakeStore();
    await store.markActive(
      { workspaceId: "W1", channel: "C1", threadTs: "100.1" },
      60,
    );
    expect(entries.size).toBe(1);
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess(
      { type: "message", channel: "C1", threadTs: "100.1", ts: "100.2" },
      "W1",
    );
    expect(decision.proceed).toBe(true);
  });

  it("allows message events without threadTs (top-level channel messages)", async () => {
    const { store } = createFakeStore();
    let reads = 0;
    const trackingStore: ActiveThreadStore = {
      async isActive(key) {
        reads += 1;
        return store.isActive(key);
      },
      markActive: store.markActive.bind(store),
    };
    const gate = new SlackThreadGate({ store: trackingStore });
    const decision = await gate.shouldProcess(
      { type: "message", channel: "C1", ts: "100.1" },
      "W1",
    );
    expect(decision.proceed).toBe(true);
    expect(reads).toBe(0);
  });

  it("scopes active threads by workspaceId (regression: cross-workspace ts collision)", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    // W1 engages a thread at ts 100.1
    await gate.onEngaged(
      { type: "mention", channel: "C1", ts: "100.1" },
      "W1",
    );
    // W2 sees a reply on a thread with the same ts 100.1 in the same-named channel
    const decision = await gate.shouldProcess(
      { type: "message", channel: "C1", threadTs: "100.1", ts: "100.2" },
      "W2",
    );
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toBe("inactive-thread");
  });

  it("scopes active threads by channel (regression: cross-channel ts collision)", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged(
      { type: "mention", channel: "C1", ts: "100.1" },
      "W1",
    );
    const decision = await gate.shouldProcess(
      { type: "message", channel: "C2", threadTs: "100.1", ts: "100.2" },
      "W1",
    );
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toBe("inactive-thread");
  });
});

describe("SlackThreadGate.onEngaged", () => {
  it("marks event.threadTs active when mention occurs inside an existing thread", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged(
      { type: "mention", channel: "C1", threadTs: "t-parent", ts: "t-new" },
      "W1",
    );
    expect(entries.has("W1:C1:t-parent")).toBe(true);
    expect(entries.has("W1:C1:t-new")).toBe(false);
  });

  it("marks event.ts active when mention occurs at top level (no threadTs)", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged(
      { type: "mention", channel: "C1", ts: "t-top" },
      "W1",
    );
    expect(entries.has("W1:C1:t-top")).toBe(true);
  });

  it("is a no-op for message events", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged(
      { type: "message", channel: "C1", threadTs: "t1", ts: "t2" },
      "W1",
    );
    expect(entries.size).toBe(0);
  });

  it("is a no-op when a mention has neither threadTs nor ts", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged({ type: "mention", channel: "C1" }, "W1");
    expect(entries.size).toBe(0);
  });
});

describe("SlackThreadGate.refresh", () => {
  it("calls markActive with the full composite key and configured ttlSeconds", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store, ttlSeconds: 3600 });
    const key: ActiveThreadKey = {
      workspaceId: "W1",
      channel: "C1",
      threadTs: "t1",
    };
    await gate.refresh(key);
    const entry = entries.get("W1:C1:t1");
    expect(entry?.ttl).toBe(3600);
    expect(entry?.key).toEqual(key);
  });
});
