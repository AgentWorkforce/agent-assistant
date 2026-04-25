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
import { consoleJsonLogger, type CfLogger } from "../observability/index.js";

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
  // Persona-injectable logger. Defaults to consoleJsonLogger (JSON to stdout,
  // surfaces in `wrangler tail --format json`). Pass a custom logger to ship
  // events to Workers Analytics Engine, Datadog, etc., or `nullLogger` to
  // silence in tests.
  logger?: CfLogger;
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
  const baseLogger = opts.logger ?? consoleJsonLogger;

  return {
    async fetch(req, env, ctx) {
      const url = new URL(req.url);
      const route = opts.webhookRoutes[url.pathname];
      const log = baseLogger.child({ component: "cf-ingress", path: url.pathname });

      if (!route) {
        log.debug("non-webhook request — delegating to inner");
        return opts.inner?.fetch?.(req, env, ctx) ?? new Response("Not Found", { status: 404 });
      }

      const routeLog = log.child({ provider: route.provider });
      routeLog.info("webhook received");

      const verification = await route.verify?.(req.clone(), env);
      if (verification && !verification.ok) {
        routeLog.warn("signature verification failed", { reason: verification.reason });
        return new Response("Unauthorized", { status: 401 });
      }

      const result = await route.parse(req, env);
      routeLog.debug("parse complete", { kind: result.kind, hasDedupKey: Boolean(result.dedupKey) });
      if (result.kind === "ack") {
        routeLog.info("ack-only response", { status: result.response.status });
        return result.response;
      }

      const shouldDispatch = await shouldDispatchWebhook(req, env, route, result, opts, routeLog);
      if (!shouldDispatch) {
        routeLog.info("duplicate event — skipping enqueue");
        return new Response("OK", { status: 200 });
      }

      const queue = env[opts.queueBinding] as Queue;
      const receivedAt = new Date().toISOString();
      await queue.send({
        type: "webhook",
        provider: route.provider,
        descriptor: result.turn,
        receivedAt,
      });
      routeLog.info("turn enqueued", { receivedAt });

      return result.response;
    },
  };
}

async function shouldDispatchWebhook<Env>(
  req: CfIngressRequest,
  env: Env,
  route: WebhookRouteConfig<Env>,
  result: ParseResult,
  opts: CfIngressOptions<Env>,
  log: CfLogger,
): Promise<boolean> {
  const key = getProviderDedupKey(req, route.provider, result);
  if (!key) {
    log.debug("no dedup key — letting through");
    return true;
  }

  if (!opts.dedupBinding) {
    throw new CfIngressConfigurationError("dedupBinding is required for webhook ingress");
  }
  const kv = env[opts.dedupBinding] as KVNamespace;
  const gate = new SlackEventDedupGate({
    store: new KvSlackEventDedupStore(kv),
    ttlSeconds: opts.dedupTtlSeconds,
  });
  const decision = await gate.claim({ eventId: key });
  log.debug("dedup decision", { dedupKey: key, proceed: decision.proceed, reason: decision.reason });
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

  // For nango (and any future provider), the persona's parse() supplies the
  // dedup key explicitly via result.dedupKey. We do NOT fall back to Slack-
  // shaped extraction — nango envelopes don't have Slack's eventId/ts fields,
  // and silently returning undefined would mean dedup is skipped entirely.
  // Personas wire result.dedupKey from whatever stable header / payload field
  // their provider exposes (e.g. nango delivery_id).
  return result.dedupKey?.eventId ?? result.dedupKey?.ts ?? undefined;
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
