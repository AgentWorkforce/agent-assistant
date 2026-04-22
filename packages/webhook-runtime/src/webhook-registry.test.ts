import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebhookRegistry, WebhookRegistry } from "./webhook-registry.js";
import type {
  NormalizedWebhook,
  RegistryLogger,
  WebhookConsumer,
  WebhookConsumerPredicate,
  WebhookProvider,
} from "./types.js";

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type LocalConsumer = Extract<WebhookConsumer, { kind: "local" }>;
type HttpConsumer = Extract<WebhookConsumer, { kind: "http" }>;

type ConsumerOverrides = {
  provider?: WebhookProvider;
  providers?: readonly WebhookProvider[];
  predicate?: WebhookConsumerPredicate;
  timeoutMs?: number;
};

type HttpConsumerOverrides = ConsumerOverrides & {
  url?: string;
  headers?: Record<string, string>;
};

function okResponse(): Response {
  return new Response(null, { status: 204 });
}

function createFetchMock(implementation?: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  return vi.fn<FetchImpl>(implementation ?? (async () => okResponse()));
}

function quietLogger(): Required<RegistryLogger> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function registryWith(fetchImpl = createFetchMock(), logger = quietLogger()): WebhookRegistry {
  return new WebhookRegistry({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    logger,
  });
}

function createEvent(overrides: Partial<NormalizedWebhook> = {}): NormalizedWebhook {
  return {
    provider: "slack",
    connectionId: "conn_123",
    workspaceId: "workspace_123",
    eventType: "message.created",
    payload: {
      text: "hello",
    },
    ...overrides,
  };
}

function localConsumer(
  id: string,
  handler: LocalConsumer["handler"] = vi.fn(),
  overrides: ConsumerOverrides = {},
): LocalConsumer {
  const base = {
    id,
    kind: "local",
    handler,
    predicate: overrides.predicate,
    timeoutMs: overrides.timeoutMs,
  } as const;

  if (overrides.providers) {
    return {
      ...base,
      providers: overrides.providers,
    };
  }

  return {
    ...base,
    provider: overrides.provider ?? "slack",
  };
}

function httpConsumer(
  id: string,
  overrides: HttpConsumerOverrides = {},
): HttpConsumer {
  const base = {
    id,
    kind: "http",
    url: overrides.url ?? `https://example.test/${id}`,
    headers: overrides.headers,
    predicate: overrides.predicate,
    timeoutMs: overrides.timeoutMs,
  } as const;

  if (overrides.providers) {
    return {
      ...base,
      providers: overrides.providers,
    };
  }

  return {
    ...base,
    provider: overrides.provider ?? "slack",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("WebhookRegistry", () => {
  it("register() and list(provider) filters by provider", () => {
    const registry = createWebhookRegistry({
      fetchImpl: createFetchMock() as unknown as typeof fetch,
      logger: quietLogger(),
    });
    const slack = localConsumer("slack-consumer");
    const github = localConsumer("github-consumer", vi.fn(), { provider: "github" });
    const multi = localConsumer("multi-consumer", vi.fn(), {
      providers: ["slack", "linear"],
    });

    registry.register(slack);
    registry.register(github);
    registry.register(multi);

    expect(registry.list("slack")).toEqual([slack, multi]);
    expect(registry.list("github")).toEqual([github]);
    expect(registry.list("linear")).toEqual([multi]);
    expect(registry.list("notion")).toEqual([]);
  });

  it("register() with duplicate id replaces the consumer and logs a warning", () => {
    const logger = quietLogger();
    const registry = registryWith(createFetchMock(), logger);

    registry.register(httpConsumer("duplicate", { provider: "slack" }));
    registry.register(httpConsumer("duplicate", { provider: "github" }));

    expect(registry.list("slack")).toEqual([]);
    expect(registry.list("github")).toEqual([
      httpConsumer("duplicate", { provider: "github" }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook consumer id already registered; replacing",
      expect.objectContaining({
        area: "webhook-fanout",
        consumerId: "duplicate",
      }),
    );
  });

  it("fanout() calls a local handler", async () => {
    const handler = vi.fn();
    const registry = registryWith();
    const event = createEvent();

    registry.register(localConsumer("local", handler));

    await expect(registry.fanout("slack", event)).resolves.toEqual({
      total: 1,
      succeeded: ["local"],
      failed: [],
      skipped: [],
    });
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("fanout() calls an HTTP consumer with headers and body", async () => {
    const fetchImpl = createFetchMock();
    const registry = registryWith(fetchImpl);
    const event = createEvent();

    registry.register(
      httpConsumer("http", {
        headers: {
          authorization: "Bearer token",
          "x-custom": "value",
        },
      }),
    );

    const result = await registry.fanout("slack", event);

    expect(result).toEqual({
      total: 1,
      succeeded: ["http"],
      failed: [],
      skipped: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/http",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "x-custom": "value",
          "content-type": "application/json",
          "x-agent-relay-fanout": "1",
        },
        body: JSON.stringify(event),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fanout() clears the HTTP timeout after a successful response", async () => {
    vi.useFakeTimers();
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = createFetchMock(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const registry = registryWith(fetchImpl);

    registry.register(httpConsumer("http-success", { timeoutMs: 50 }));

    const resultPromise = registry.fanout("slack", createEvent());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    if (!resolveFetch) {
      throw new Error("fetch mock was not called");
    }

    resolveFetch(okResponse());

    await expect(resultPromise).resolves.toEqual({
      total: 1,
      succeeded: ["http-success"],
      failed: [],
      skipped: [],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fanout() aborts an HTTP consumer after timeoutMs", async () => {
    vi.useFakeTimers();
    const slowSignals: AbortSignal[] = [];
    const fetchImpl = createFetchMock((input, init) => {
      if (String(input) !== "https://example.test/times-out") {
        return Promise.resolve(okResponse());
      }

      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          slowSignals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }
      });
    });
    const registry = registryWith(fetchImpl);

    registry.register(httpConsumer("times-out", { timeoutMs: 5 }));

    const resultPromise = registry.fanout("slack", createEvent());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5);
    await expect(resultPromise).resolves.toEqual({
      total: 1,
      succeeded: [],
      failed: [{ id: "times-out", error: "Timed out after 5ms" }],
      skipped: [],
    });
    expect(slowSignals).toHaveLength(1);
    expect(slowSignals[0]?.aborted).toBe(true);
  });

  it("fanout() records skipped when predicate returns false", async () => {
    const fetchImpl = createFetchMock();
    const predicate = vi.fn(() => false);
    const registry = registryWith(fetchImpl);
    const event = createEvent();

    registry.register(httpConsumer("predicate-skip", { predicate }));

    await expect(registry.fanout("slack", event)).resolves.toEqual({
      total: 1,
      succeeded: [],
      failed: [],
      skipped: [{ id: "predicate-skip", reason: "predicate" }],
    });
    expect(predicate).toHaveBeenCalledWith(event);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fanoutExcept() skips excluded ids", async () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const registry = registryWith();
    const event = createEvent();

    registry.register(localConsumer("first", firstHandler));
    registry.register(localConsumer("second", secondHandler));

    await expect(registry.fanoutExcept("slack", event, ["second"])).resolves.toEqual({
      total: 1,
      succeeded: ["first"],
      failed: [],
      skipped: [],
    });
    expect(firstHandler).toHaveBeenCalledWith(event);
    expect(secondHandler).not.toHaveBeenCalled();
  });

  it("unregister() and clear() release dynamically registered consumers", () => {
    const registry = registryWith();

    registry.register(localConsumer("dynamic-1"));
    registry.register(localConsumer("dynamic-2"));
    registry.register(localConsumer("dynamic-3"));

    expect(registry.list("slack").map((consumer) => consumer.id)).toEqual([
      "dynamic-1",
      "dynamic-2",
      "dynamic-3",
    ]);
    expect(registry.unregister("dynamic-2")).toBe(true);
    expect(registry.unregister("missing")).toBe(false);
    expect(registry.list("slack").map((consumer) => consumer.id)).toEqual([
      "dynamic-1",
      "dynamic-3",
    ]);

    registry.clear();

    expect(registry.list("slack")).toEqual([]);
  });
});
