import { describe, it, expect } from "vitest";

import {
  SlackThreadGate,
  type ActiveThreadStore,
  type ActiveThreadContext,
} from "./slack-thread-gate.js";

function createFakeStore() {
  const entries = new Map<string, { ctx: ActiveThreadContext; ttl: number }>();
  const store: ActiveThreadStore = {
    async isActive(ts) {
      return entries.has(ts);
    },
    async markActive(ts, ctx, ttl) {
      entries.set(ts, { ctx, ttl });
    },
  };
  return { store, entries };
}

describe("SlackThreadGate.shouldProcess", () => {
  it("allows mention events regardless of store state", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess({
      type: "mention",
      channel: "C1",
      ts: "100.1",
    });
    expect(decision.proceed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("drops message events with threadTs when the thread is inactive", async () => {
    const { store } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess({
      type: "message",
      channel: "C1",
      threadTs: "100.1",
      ts: "100.2",
    });
    expect(decision.proceed).toBe(false);
    expect(decision.reason).toBe("inactive-thread");
  });

  it("allows message events with threadTs when the thread is active", async () => {
    const { store, entries } = createFakeStore();
    await store.markActive("100.1", { workspaceId: "W1", channel: "C1" }, 60);
    expect(entries.has("100.1")).toBe(true);
    const gate = new SlackThreadGate({ store });
    const decision = await gate.shouldProcess({
      type: "message",
      channel: "C1",
      threadTs: "100.1",
      ts: "100.2",
    });
    expect(decision.proceed).toBe(true);
  });

  it("allows message events without threadTs (top-level channel messages)", async () => {
    const { store } = createFakeStore();
    let reads = 0;
    const trackingStore: ActiveThreadStore = {
      async isActive(ts) {
        reads += 1;
        return store.isActive(ts);
      },
      markActive: store.markActive.bind(store),
    };
    const gate = new SlackThreadGate({ store: trackingStore });
    const decision = await gate.shouldProcess({
      type: "message",
      channel: "C1",
      ts: "100.1",
    });
    expect(decision.proceed).toBe(true);
    expect(reads).toBe(0);
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
    expect(entries.has("t-parent")).toBe(true);
    expect(entries.has("t-new")).toBe(false);
  });

  it("marks event.ts active when mention occurs at top level (no threadTs)", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store });
    await gate.onEngaged(
      { type: "mention", channel: "C1", ts: "t-top" },
      "W1",
    );
    expect(entries.has("t-top")).toBe(true);
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
  it("calls markActive with the caller-provided context and configured ttlSeconds", async () => {
    const { store, entries } = createFakeStore();
    const gate = new SlackThreadGate({ store, ttlSeconds: 3600 });
    const ctx: ActiveThreadContext = { workspaceId: "W1", channel: "C1" };
    await gate.refresh("t1", ctx);
    const entry = entries.get("t1");
    expect(entry?.ttl).toBe(3600);
    expect(entry?.ctx).toEqual(ctx);
  });
});
