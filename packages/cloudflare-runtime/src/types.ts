import type { ContinuationResumeTrigger } from '@agent-assistant/continuation';
import type {
  DurableObjectNamespace,
  KVNamespace,
  Queue,
} from '@cloudflare/workers-types';

export type TurnQueueProvider = 'slack' | 'github' | 'nango';

export interface WebhookQueueMessage {
  type: 'webhook';
  provider: TurnQueueProvider;
  descriptor: unknown;
  receivedAt: string;
}

export interface ResumeQueueMessage {
  type: 'resume';
  continuationId: string;
  trigger: ContinuationResumeTrigger;
}

export interface SpecialistCallQueueMessage {
  type: 'specialist_call';
  turnId: string;
  capability: string;
  input: unknown;
  callbackTrigger: ContinuationResumeTrigger;
}

export interface SpecialistResultQueueMessage {
  type: 'specialist_result';
  callbackTrigger: ContinuationResumeTrigger;
  result: unknown;
  error?: {
    message: string;
    code?: string;
  };
}

export type TurnQueueMessage =
  | WebhookQueueMessage
  | ResumeQueueMessage
  | SpecialistCallQueueMessage
  | SpecialistResultQueueMessage;

export interface CfBindingsShape<TMessage extends TurnQueueMessage = TurnQueueMessage> {
  TURN_QUEUE: Queue<TMessage>;
  DEAD_LETTER_QUEUE?: Queue<TMessage>;
  DEDUP?: KVNamespace;
  CONTINUATIONS?: KVNamespace;
  TURN_EXECUTOR_DO?: DurableObjectNamespace;
  [binding: string]: unknown;
}
