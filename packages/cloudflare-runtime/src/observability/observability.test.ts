import { describe, expect, it, vi } from "vitest";

import { wrapCloudflareWorker } from "../ingress/cf-ingress.js";
import { handleCfQueue } from "../executor/cf-turn-executor.js";
import {
  createCapturingLogger,
  createConsoleJsonLogger,
  nullLogger,
} from "./logger.js";

describe("CfLogger", () => {
  it("emits structured JSON to the configured sink", () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = createConsoleJsonLogger({ sink, level: "debug", bindings: { service: "x" } });
    logger.info("hello", { k: 1 });
    expect(sink.info).toHaveBeenCalledTimes(1);
    const line = sink.info.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("hello");
    expect(parsed.service).toBe("x");
    expect(parsed.k).toBe(1);
    expect(typeof parsed.time).toBe("string");
  });

  it("respects level threshold (debug suppressed at info)", () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = createConsoleJsonLogger({ sink, level: "info" });
    logger.debug("nope");
    logger.info("yep");
    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).toHaveBeenCalledTimes(1);
  });

  it("child() merges bindings", () => {
    const { logger, records } = createCapturingLogger();
    const turnLog = logger.child({ turnId: "T1" });
    turnLog.info("hello");
    turnLog.child({ step: "parse" }).info("nested");
    expect(records).toHaveLength(2);
    expect(records[0].data).toMatchObject({ turnId: "T1" });
    expect(records[1].data).toMatchObject({ turnId: "T1", step: "parse" });
  });
});

describe("ingress logger wiring", () => {
  it("emits webhook lifecycle events with the injected logger", async () => {
    const { logger, records } = createCapturingLogger();

    const sentMessages: unknown[] = [];
    const fakeQueue = { send: async (m: unknown) => { sentMessages.push(m); } };
    const dedupStore = new Map<string, string>();
    const fakeKv = {
      async get(k: string) { return dedupStore.get(k) ?? null; },
      async put(k: string, v: string) { dedupStore.set(k, v); },
    };

    const env = { TURN_QUEUE: fakeQueue, DEDUP: fakeKv } as unknown as { TURN_QUEUE: unknown; DEDUP: unknown };

    const handler = wrapCloudflareWorker<typeof env>({
      logger,
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
      webhookRoutes: {
        "/api/webhooks/slack": {
          provider: "slack",
          verify: async () => ({ ok: true as const }),
          parse: async () => ({
            kind: "dispatch",
            response: new Response("OK", { status: 200 }),
            turn: { id: "evt-1" },
            dedupKey: { eventId: "evt-1" },
          }),
        },
      },
    });

    const req = {
      url: "https://sage.test/api/webhooks/slack",
      headers: new Headers(),
      clone() { return this; },
    } as unknown as Request;

    // Cast ctx to any — we only care that it's passed through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler.fetch!(req as any, env, {} as any);

    const events = records.map((r) => r.event);
    expect(events).toContain("webhook received");
    expect(events).toContain("turn enqueued");
    // Signature verification did NOT fail; we should NOT see the warn event.
    expect(events).not.toContain("signature verification failed");

    // Second delivery of the same event-id is deduped.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler.fetch!(req as any, env, {} as any);
    expect(events.filter((e) => e === "turn enqueued")).toHaveLength(1);
    expect(records.some((r) => r.event === "duplicate event — skipping enqueue")).toBe(true);
  });
});

describe("executor logger wiring", () => {
  it("logs dispatch start + complete with waitUntilCount", async () => {
    const { logger, records } = createCapturingLogger();

    let acked = 0;
    const message = {
      body: { type: "webhook", provider: "slack", descriptor: { id: "T1" }, receivedAt: "now" },
      ack: () => { acked++; },
    };

    await handleCfQueue<{}, typeof message.body>(
      { messages: [message as unknown as { body: typeof message.body }] },
      {} as {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      {
        logger,
        runTurn: async (_msg, _env, ctx) => {
          // Schedule a waitUntil so we can verify the count is captured.
          ctx.waitUntil(Promise.resolve());
          ctx.waitUntil(Promise.resolve());
        },
        resolveTurnId: (m) => (m as { descriptor?: { id?: string } }).descriptor?.id,
      },
    );

    expect(acked).toBe(1);
    const events = records.map((r) => r.event);
    expect(events).toContain("dispatch start");
    expect(events).toContain("dispatch complete");

    const completeRec = records.find((r) => r.event === "dispatch complete")!;
    expect(completeRec.data.turnId).toBe("T1");
    expect(completeRec.data.waitUntilCount).toBe(2);
  });

  it("logs dispatch failed with error message + still calls retry", async () => {
    const { logger, records } = createCapturingLogger();

    let retried = 0;
    const message = {
      body: { type: "webhook", provider: "slack", descriptor: {}, receivedAt: "now" },
      retry: () => { retried++; },
    };

    await expect(
      handleCfQueue<{}, typeof message.body>(
        { messages: [message as unknown as { body: typeof message.body }] },
        {} as {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        {
          logger,
          runTurn: () => {
            throw new Error("boom");
          },
        },
      ),
    ).rejects.toThrow("boom");

    expect(retried).toBe(1);
    const failed = records.find((r) => r.event === "dispatch failed");
    expect(failed?.data.error).toBe("boom");
    expect(failed?.level).toBe("error");
  });
});

describe("nullLogger", () => {
  it("is a no-op and supports child()", () => {
    expect(() => nullLogger.info("nope")).not.toThrow();
    expect(nullLogger.child({ x: 1 })).toBe(nullLogger);
  });
});
