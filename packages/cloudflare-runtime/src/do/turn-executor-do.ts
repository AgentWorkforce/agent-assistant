import type { DurableObjectState, ExecutionContext } from '@cloudflare/workers-types';

import type { TurnQueueMessage } from '../types.js';
import { createFakeExecutionContext } from '../executor/fake-execution-context.js';

export interface TurnExecutorDORequest<Message extends TurnQueueMessage = TurnQueueMessage> {
  message: Message;
}

export abstract class TurnExecutorDO<
  Env = unknown,
  Message extends TurnQueueMessage = TurnQueueMessage,
> {
  private tail: Promise<void> = Promise.resolve();

  protected constructor(
    protected readonly state: DurableObjectState,
    protected readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const payload = await request.json() as TurnExecutorDORequest<Message>;
    await this.enqueue(payload.message);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }

  async runSerialized(message: Message): Promise<void> {
    await this.enqueue(message);
  }

  protected abstract runTurn(
    message: Message,
    ctx: ExecutionContext,
  ): Promise<void> | void;

  private async enqueue(message: Message): Promise<void> {
    const run = this.tail.then(async () => {
      const fake = createFakeExecutionContext();
      await this.runTurn(message, fake.ctx);
      await fake.settleAll();
    });

    this.tail = run.catch(() => undefined);
    await run;
  }
}
