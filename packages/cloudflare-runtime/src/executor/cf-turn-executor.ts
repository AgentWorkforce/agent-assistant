import type { ExecutionContext } from '@cloudflare/workers-types';

import type { TurnQueueMessage } from '../types.js';
import { consoleJsonLogger, type CfLogger } from '../observability/index.js';
import { createFakeExecutionContext } from './fake-execution-context.js';

export interface CfQueueMessage<Body> {
  body: Body;
  ack?(): void;
  retry?(options?: { delaySeconds?: number }): void;
}

export interface CfQueueBatch<Body> {
  messages: CfQueueMessage<Body>[];
}

export interface CfTurnExecutorOptions<
  Env,
  Message extends TurnQueueMessage = TurnQueueMessage,
> {
  runTurn(message: Message, env: Env, ctx: ExecutionContext): Promise<void> | void;
  onMessageError?(
    error: unknown,
    message: CfQueueMessage<Message>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> | void;
  // Persona-injectable logger. Defaults to consoleJsonLogger.
  logger?: CfLogger;
  // Optional correlation-id extractor. If provided, every log line for a
  // message includes the result as `turnId`. Useful for greppable per-turn
  // tracing across ingress, executor, and delivery.
  resolveTurnId?(message: Message): string | undefined;
}

export async function handleCfQueue<
  Env,
  Message extends TurnQueueMessage = TurnQueueMessage,
>(
  batch: CfQueueBatch<Message>,
  env: Env,
  ctx: ExecutionContext,
  options: CfTurnExecutorOptions<Env, Message>,
): Promise<void> {
  const baseLogger = (options.logger ?? consoleJsonLogger).child({
    component: "cf-turn-executor",
  });
  baseLogger.debug("batch received", { count: batch.messages.length });

  for (const message of batch.messages) {
    const turnId = options.resolveTurnId?.(message.body);
    const log = baseLogger.child({
      messageType: (message.body as { type?: string })?.type,
      ...(turnId ? { turnId } : {}),
    });
    const fake = createFakeExecutionContext();
    const startedAt = Date.now();

    try {
      log.debug("dispatch start");
      await options.runTurn(message.body, env, fake.ctx);
      const pendingBeforeSettle = fake.pendingCount?.() ?? 0;
      await fake.settleAll();
      message.ack?.();
      log.info("dispatch complete", {
        durationMs: Date.now() - startedAt,
        waitUntilCount: pendingBeforeSettle,
      });
    } catch (error) {
      log.error("dispatch failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      await options.onMessageError?.(error, message, env, ctx);
      message.retry?.();
      throw error;
    }
  }
}

export function createCfTurnExecutor<
  Env,
  Message extends TurnQueueMessage = TurnQueueMessage,
>(
  options: CfTurnExecutorOptions<Env, Message>,
): (
  batch: CfQueueBatch<Message>,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void> {
  return (batch, env, ctx) => handleCfQueue(batch, env, ctx, options);
}
