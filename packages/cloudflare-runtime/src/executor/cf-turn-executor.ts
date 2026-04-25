import type { ExecutionContext } from '@cloudflare/workers-types';

import type { TurnQueueMessage } from '../types.js';
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
  for (const message of batch.messages) {
    const fake = createFakeExecutionContext();

    try {
      await options.runTurn(message.body, env, fake.ctx);
      await fake.settleAll();
      message.ack?.();
    } catch (error) {
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
