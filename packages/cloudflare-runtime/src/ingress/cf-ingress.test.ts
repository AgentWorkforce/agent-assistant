import { describe, expect, it, vi } from "vitest";
import {
  CfIngressConfigurationError,
  wrapCloudflareWorker,
  type ParseResult,
} from "./cf-ingress.js";

type TestEnv = {
  TURN_QUEUE: { send: ReturnType<typeof vi.fn> };
  DEDUP: InMemoryKv;
};

class InMemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function createEnv(): TestEnv {
  return {
    TURN_QUEUE: { send: vi.fn(async () => undefined) },
    DEDUP: new InMemoryKv(),
  };
}

function request(path = "/api/webhooks/slack", init?: RequestInit): Request {
  return new Request(`https://example.test${path}`, init);
}

function dispatchResult(): ParseResult {
  return {
    kind: "dispatch",
    response: new Response("accepted", { status: 200 }),
    turn: { id: "turn_123", text: "hello" },
    dedupKey: { eventId: "Ev123", ts: "1700000000.000100" },
  };
}

function verifiedSlackRoute(parse = vi.fn(async () => dispatchResult())) {
  return {
    provider: "slack" as const,
    verify: vi.fn(async () => ({ ok: true as const })),
    parse,
  };
}

describe("wrapCloudflareWorker", () => {
  it("verifies, parses, dedups, enqueues, and returns the persona response", async () => {
    const env = createEnv();
    const verify = vi.fn(async () => ({ ok: true as const }));
    const parse = vi.fn(async () => dispatchResult());
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/slack": { provider: "slack", verify, parse },
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    const response = await worker.fetch?.(request(), env, {} as ExecutionContext);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("accepted");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(env.TURN_QUEUE.send).toHaveBeenCalledTimes(1);
    expect(env.TURN_QUEUE.send).toHaveBeenCalledWith({
      type: "webhook",
      provider: "slack",
      descriptor: { id: "turn_123", text: "hello" },
      receivedAt: expect.any(String),
    });
    expect(env.DEDUP.values.get("Ev123")).toBe("1");
  });

  it("returns 401 without parsing, deduping, or enqueueing when verification fails", async () => {
    const env = createEnv();
    const verify = vi.fn(async () => ({ ok: false as const, reason: "bad_signature" }));
    const parse = vi.fn(async () => dispatchResult());
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/slack": { provider: "slack", verify, parse },
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    const response = await worker.fetch?.(request(), env, {} as ExecutionContext);

    expect(response?.status).toBe(401);
    expect(parse).not.toHaveBeenCalled();
    expect(env.TURN_QUEUE.send).not.toHaveBeenCalled();
    expect(env.DEDUP.values.size).toBe(0);
  });

  it("returns ack responses without deduping or enqueueing", async () => {
    const env = createEnv();
    const parse = vi.fn(async (): Promise<ParseResult> => ({
      kind: "ack",
      response: new Response("challenge", { status: 200 }),
    }));
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/slack": verifiedSlackRoute(parse),
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    const response = await worker.fetch?.(request(), env, {} as ExecutionContext);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("challenge");
    expect(env.TURN_QUEUE.send).not.toHaveBeenCalled();
    expect(env.DEDUP.values.size).toBe(0);
  });

  it("dedups repeated Slack event ids at ingress and enqueues once", async () => {
    const env = createEnv();
    const parse = vi.fn(async () => dispatchResult());
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/slack": verifiedSlackRoute(parse),
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    const first = await worker.fetch?.(request(), env, {} as ExecutionContext);
    const second = await worker.fetch?.(request(), env, {} as ExecutionContext);

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(env.TURN_QUEUE.send).toHaveBeenCalledTimes(1);
  });

  it("propagates queue send failures so the platform can retry", async () => {
    const env = createEnv();
    env.TURN_QUEUE.send.mockRejectedValueOnce(new Error("queue unavailable"));
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/slack": verifiedSlackRoute(vi.fn(async () => dispatchResult())),
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    await expect(worker.fetch?.(request(), env, {} as ExecutionContext)).rejects.toThrow(
      "queue unavailable",
    );
  });

  it("falls back to the inner worker for non-webhook routes", async () => {
    const env = createEnv();
    const innerFetch = vi.fn(async () => new Response("inner", { status: 200 }));
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {},
      inner: { fetch: innerFetch },
      queueBinding: "TURN_QUEUE",
    });

    const response = await worker.fetch?.(request("/health"), env, {} as ExecutionContext);

    expect(response?.status).toBe(200);
    expect(innerFetch).toHaveBeenCalledTimes(1);
  });

  it("does not attach a stub queue handler", () => {
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {},
      queueBinding: "TURN_QUEUE",
    });

    expect(worker.queue).toBeUndefined();
  });

  it("fails loud when a Slack route is missing signature verification", () => {
    expect(() =>
      wrapCloudflareWorker<TestEnv>({
        webhookRoutes: {
          "/api/webhooks/slack": { provider: "slack", parse: vi.fn(async () => dispatchResult()) },
        },
        queueBinding: "TURN_QUEUE",
        dedupBinding: "DEDUP",
      }),
    ).toThrow(CfIngressConfigurationError);
  });

  it("fails loud when ingress dedup storage is not configured", () => {
    expect(() =>
      wrapCloudflareWorker<TestEnv>({
        webhookRoutes: {
          "/api/webhooks/slack": {
            provider: "slack",
            verify: vi.fn(async () => ({ ok: true as const })),
            parse: vi.fn(async () => dispatchResult()),
          },
        },
        queueBinding: "TURN_QUEUE",
      }),
    ).toThrow(CfIngressConfigurationError);
  });

  it("dedups nango webhooks via the persona-supplied dedupKey (no Slack fall-through)", async () => {
    const env = createEnv();
    const parse = vi.fn(async (): Promise<ParseResult> => ({
      kind: "dispatch",
      response: new Response("accepted", { status: 200 }),
      turn: { id: "n-1" },
      dedupKey: { eventId: "nango-delivery-abc" },
    }));
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/nango": { provider: "nango", parse },
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    await worker.fetch?.(request("/api/webhooks/nango"), env, {} as ExecutionContext);
    await worker.fetch?.(request("/api/webhooks/nango"), env, {} as ExecutionContext);

    // Second delivery with the same persona-supplied dedup key is skipped —
    // proves dedup runs for nango (regression: previously fell through to
    // Slack-shaped extraction which silently returned undefined and skipped).
    expect(env.TURN_QUEUE.send).toHaveBeenCalledTimes(1);
  });

  it("does not dedup nango when the persona supplies no dedupKey", async () => {
    const env = createEnv();
    const parse = vi.fn(async (): Promise<ParseResult> => ({
      kind: "dispatch",
      response: new Response("accepted", { status: 200 }),
      turn: { id: "n-1" },
      // No dedupKey — persona explicitly opts out.
    }));
    const worker = wrapCloudflareWorker<TestEnv>({
      webhookRoutes: {
        "/api/webhooks/nango": { provider: "nango", parse },
      },
      queueBinding: "TURN_QUEUE",
      dedupBinding: "DEDUP",
    });

    await worker.fetch?.(request("/api/webhooks/nango"), env, {} as ExecutionContext);
    await worker.fetch?.(request("/api/webhooks/nango"), env, {} as ExecutionContext);

    expect(env.TURN_QUEUE.send).toHaveBeenCalledTimes(2);
  });
});
