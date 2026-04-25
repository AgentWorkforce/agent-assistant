import {
  SlackEventDedupGate,
  getSlackDeduplicationKey,
  type SlackEventDedupStore,
} from "@agent-assistant/surfaces";
import type {
  ExecutionContext,
  KVNamespace,
  Queue,
} from "@cloudflare/workers-types";

type MaybePromise<T> = T | Promise<T>;

export interface CfIngressRequest {
  readonly url: string;
  readonly headers: Headers;
  clone(): CfIngressRequest;
}

export type CfFetchHandler<Env> = (
  req: CfIngressRequest,
  env: Env,
  ctx: ExecutionContext,
) => MaybePromise<Response>;

export interface CfWorkerHandler<Env> {
  fetch?: CfFetchHandler<Env>;
  queue?: (batch: unknown, env: Env, ctx: ExecutionContext) => MaybePromise<void>;
}

export interface ParseResult {
  kind: "ack" | "dispatch";
  response: Response;
  turn?: unknown;
  dedupKey?: { eventId?: string; ts?: string };
}

export interface WebhookRouteConfig<Env> {
  provider: "slack" | "github" | "nango";
  verify?: (
    req: CfIngressRequest,
    env: Env,
  ) => Promise<{ ok: true } | { ok: false; reason?: string }>;
  parse: (req: CfIngressRequest, env: Env) => Promise<ParseResult>;
}

export interface CfIngressOptions<Env> {
  webhookRoutes: Record<string, WebhookRouteConfig<Env>>;
  inner?: { fetch?: CfFetchHandler<Env> };
  queueBinding: keyof Env & string;
  dedupBinding?: keyof Env & string;
  dedupTtlSeconds?: number;
  continuationBinding?: keyof Env & string;
  turnExecutorDoBinding?: keyof Env & string;
}

export class CfIngressConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfIngressConfigurationError";
  }
}

class KvSlackEventDedupStore implements SlackEventDedupStore {
  constructor(private readonly kv: KVNamespace) {}

  async hasBeenProcessed(key: string): Promise<boolean> {
    return (await this.kv.get(key)) !== null;
  }

  async markProcessed(key: string, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, "1", { expirationTtl: ttlSeconds });
  }
}

export function wrapCloudflareWorker<Env>(
  opts: CfIngressOptions<Env>,
): CfWorkerHandler<Env> {
  validateOptions(opts);

  return {
    async fetch(req, env, ctx) {
      const route = opts.webhookRoutes[new URL(req.url).pathname];
      if (!route) {
        return opts.inner?.fetch?.(req, env, ctx) ?? new Response("Not Found", { status: 404 });
      }

      const verification = await route.verify?.(req.clone(), env);
      if (verification && !verification.ok) {
        return new Response("Unauthorized", { status: 401 });
      }

      const result = await route.parse(req, env);
      if (result.kind === "ack") return result.response;

      const shouldDispatch = await shouldDispatchWebhook(req, env, route, result, opts);
      if (!shouldDispatch) return new Response("OK", { status: 200 });

      const queue = env[opts.queueBinding] as Queue;
      await queue.send({
        type: "webhook",
        provider: route.provider,
        descriptor: result.turn,
        receivedAt: new Date().toISOString(),
      });

      return result.response;
    },

    queue: handleCfQueue,
  };
}

export async function handleCfQueue(): Promise<void> {
  throw new Error("executor not wired — see W3");
}

async function shouldDispatchWebhook<Env>(
  req: CfIngressRequest,
  env: Env,
  route: WebhookRouteConfig<Env>,
  result: ParseResult,
  opts: CfIngressOptions<Env>,
): Promise<boolean> {
  const key = getProviderDedupKey(req, route.provider, result);
  if (!key) return true;

  if (!opts.dedupBinding) {
    throw new CfIngressConfigurationError("dedupBinding is required for webhook ingress");
  }
  const kv = env[opts.dedupBinding] as KVNamespace;
  const gate = new SlackEventDedupGate({
    store: new KvSlackEventDedupStore(kv),
    ttlSeconds: opts.dedupTtlSeconds,
  });
  const decision = await gate.claim({ eventId: key });
  return decision.proceed;
}

function getProviderDedupKey<Env>(
  req: CfIngressRequest,
  provider: WebhookRouteConfig<Env>["provider"],
  result: ParseResult,
): string | undefined {
  if (provider === "github") {
    const deliveryId = req.headers.get("x-github-delivery");
    return deliveryId && deliveryId.length > 0 ? deliveryId : undefined;
  }

  if (provider === "slack") {
    return getSlackDeduplicationKey(result.dedupKey ?? {});
  }

  return getSlackDeduplicationKey(result.dedupKey ?? {});
}

function validateOptions<Env>(opts: CfIngressOptions<Env>): void {
  if (Object.keys(opts.webhookRoutes).length > 0 && !opts.dedupBinding) {
    throw new CfIngressConfigurationError("dedupBinding is required for webhook ingress");
  }

  for (const [path, route] of Object.entries(opts.webhookRoutes)) {
    if ((route.provider === "slack" || route.provider === "github") && !route.verify) {
      throw new CfIngressConfigurationError(
        `webhook route ${path} requires verify for provider ${route.provider}`,
      );
    }
  }
}
