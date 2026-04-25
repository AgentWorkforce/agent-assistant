import type { Queue } from '@cloudflare/workers-types';
import type { ContinuationResumeTrigger } from '@agent-assistant/continuation';

import type { TurnQueueMessage } from '../types.js';

export interface SpecialistCallInput {
  turnId: string;
  capability: string;
  input: unknown;
  callbackTrigger: ContinuationResumeTrigger;
}

export interface SpecialistResultInput {
  callbackTrigger: ContinuationResumeTrigger;
  result: unknown;
  error?: {
    message: string;
    code?: string;
  };
}

export class CfSpecialistClient {
  constructor(private readonly queue: Queue<TurnQueueMessage>) {}

  async callSpecialist(input: SpecialistCallInput): Promise<void> {
    await this.queue.send({
      type: 'specialist_call',
      turnId: input.turnId,
      capability: input.capability,
      input: input.input,
      callbackTrigger: input.callbackTrigger,
    });
  }

  async publishResult(input: SpecialistResultInput): Promise<void> {
    await this.queue.send({
      type: 'specialist_result',
      callbackTrigger: input.callbackTrigger,
      result: input.result,
      error: input.error,
    });
  }
}
