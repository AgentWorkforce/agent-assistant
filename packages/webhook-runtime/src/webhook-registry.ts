import type {
  FanoutResult,
  NormalizedWebhook,
  RegistryLogger,
  WebhookConsumer,
  WebhookProvider,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const FANOUT_HEADER = "x-agent-relay-fanout";

export type WebhookRegistryOptions = {
  fetchImpl?: typeof fetch;
  logger?: RegistryLogger;
};

type ConsumerDispatchResult =
  | {
      id: string;
      status: "succeeded";
    }
  | {
      id: string;
      status: "skipped";
      reason: "predicate";
    };

class WebhookConsumerError extends Error {
  constructor(
    readonly consumerId: string,
    error: unknown,
  ) {
    super(errorToMessage(error));
    this.name = "WebhookConsumerError";
  }
}

const consoleLogger: RegistryLogger = {
  info(message, context) {
    console.info(message, context);
  },
  warn(message, context) {
    console.warn(message, context);
  },
  error(message, context) {
    console.error(message, context);
  },
};

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeId(id: string): string {
  return id.trim();
}

function consumerProviders(consumer: WebhookConsumer): readonly WebhookProvider[] {
  if (consumer.providers) {
    return consumer.providers;
  }

  return [consumer.provider];
}

function matchesProvider(consumer: WebhookConsumer, provider: WebhookProvider): boolean {
  return consumerProviders(consumer).includes(provider);
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return timeoutMs;
}

function emptyFanoutResult(): FanoutResult {
  return {
    total: 0,
    succeeded: [],
    failed: [],
    skipped: [],
  };
}

function eventTypeForLog(event: NormalizedWebhook): string | undefined {
  try {
    return typeof event.eventType === "string" ? event.eventType : undefined;
  } catch {
    return undefined;
  }
}

export class WebhookRegistry {
  private readonly consumers = new Map<string, WebhookConsumer>();
  private readonly fetchImpl: typeof fetch;
  private readonly log: RegistryLogger;

  constructor(options: WebhookRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.log = options.logger ?? consoleLogger;
  }

  register(consumer: WebhookConsumer): void {
    const id = normalizeId(consumer.id);
    if (!id) {
      throw new Error("Webhook consumer id is required");
    }

    const normalized = {
      ...consumer,
      id,
    } as WebhookConsumer;

    if (this.consumers.has(id)) {
      void this.log.warn?.("Webhook consumer id already registered; replacing", {
        area: "webhook-fanout",
        consumerId: id,
      });
    }

    this.consumers.set(id, normalized);
  }

  unregister(id: string): boolean {
    return this.consumers.delete(normalizeId(id));
  }

  clear(): void {
    this.consumers.clear();
  }

  get(id: string): WebhookConsumer | undefined {
    return this.consumers.get(normalizeId(id));
  }

  list(provider: WebhookProvider): WebhookConsumer[] {
    return Array.from(this.consumers.values()).filter((consumer) =>
      matchesProvider(consumer, provider),
    );
  }

  async fanout(
    provider: WebhookProvider,
    event: NormalizedWebhook,
  ): Promise<FanoutResult> {
    return this.fanoutInternal(provider, event, new Set());
  }

  async fanoutExcept(
    provider: WebhookProvider,
    event: NormalizedWebhook,
    excludedIds: Iterable<string>,
  ): Promise<FanoutResult> {
    return this.fanoutInternal(
      provider,
      event,
      new Set(Array.from(excludedIds, normalizeId)),
    );
  }

  private async fanoutInternal(
    provider: WebhookProvider,
    event: NormalizedWebhook,
    excludedIds: ReadonlySet<string>,
  ): Promise<FanoutResult> {
    const result = emptyFanoutResult();

    try {
      const consumers = this.list(provider).filter(
        (consumer) => !excludedIds.has(consumer.id),
      );
      result.total = consumers.length;

      const settled = await Promise.allSettled(
        consumers.map((consumer) => this.dispatchConsumer(consumer, event)),
      );

      for (const entry of settled) {
        if (entry.status === "fulfilled") {
          if (entry.value.status === "skipped") {
            result.skipped.push({
              id: entry.value.id,
              reason: entry.value.reason,
            });
          } else {
            result.succeeded.push(entry.value.id);
          }
          continue;
        }

        const failure = this.normalizeFailure(entry.reason);
        result.failed.push(failure);
        void this.log.error?.("Webhook consumer fanout failed", {
          area: "webhook-fanout",
          provider,
          consumerId: failure.id,
          eventType: eventTypeForLog(event),
          error: failure.error,
        });
      }

      void this.log.info?.("Webhook fanout completed", {
        area: "webhook-fanout",
        provider,
        eventType: eventTypeForLog(event),
        total: result.total,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
      });

      return result;
    } catch (error) {
      const message = errorToMessage(error);
      result.failed.push({
        id: "webhook-consumer-registry",
        error: message,
      });
      void this.log.error?.("Webhook fanout registry failed", {
        area: "webhook-fanout",
        provider,
        eventType: eventTypeForLog(event),
        error: message,
      });
      return result;
    }
  }

  private async dispatchConsumer(
    consumer: WebhookConsumer,
    event: NormalizedWebhook,
  ): Promise<ConsumerDispatchResult> {
    try {
      if (consumer.predicate && !(await consumer.predicate(event))) {
        return {
          id: consumer.id,
          status: "skipped",
          reason: "predicate",
        };
      }

      if (consumer.kind === "local") {
        await consumer.handler(event);
      } else {
        await this.dispatchHttpConsumer(consumer, event);
      }

      return {
        id: consumer.id,
        status: "succeeded",
      };
    } catch (error) {
      throw new WebhookConsumerError(consumer.id, error);
    }
  }

  private async dispatchHttpConsumer(
    consumer: Extract<WebhookConsumer, { kind: "http" }>,
    event: NormalizedWebhook,
  ): Promise<void> {
    const timeoutMs = normalizeTimeoutMs(consumer.timeoutMs);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(consumer.url, {
        method: "POST",
        headers: {
          ...(consumer.headers ?? {}),
          "content-type": "application/json",
          [FANOUT_HEADER]: "1",
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }
    } catch (error) {
      if (timedOut) {
        throw new Error(`Timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeFailure(error: unknown): { id: string; error: string } {
    if (error instanceof WebhookConsumerError) {
      return {
        id: error.consumerId,
        error: error.message,
      };
    }

    return {
      id: "unknown",
      error: errorToMessage(error),
    };
  }
}

export function createWebhookRegistry(
  options?: WebhookRegistryOptions,
): WebhookRegistry {
  return new WebhookRegistry(options);
}
