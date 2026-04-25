import type {
  ContinuationDeliveryAdapter,
  ContinuationDeliveryInput,
  ContinuationDeliveryResult,
} from '@agent-assistant/continuation';

export type CfDeliveryTarget =
  | ({ kind: 'slack'; channel: string; text?: string } & Record<string, unknown>)
  | ({ kind: 'github'; repository: string; issueNumber: number; body?: string } & Record<string, unknown>)
  | ({ kind: 'a2a-callback'; url: string; payload?: unknown } & Record<string, unknown>);

export interface CfDeliveryAdapterOptions {
  slack?: (target: Extract<CfDeliveryTarget, { kind: 'slack' }>, input: ContinuationDeliveryInput) => Promise<void> | void;
  github?: (target: Extract<CfDeliveryTarget, { kind: 'github' }>, input: ContinuationDeliveryInput) => Promise<void> | void;
  a2aCallback?: (target: Extract<CfDeliveryTarget, { kind: 'a2a-callback' }>, input: ContinuationDeliveryInput) => Promise<void> | void;
}

export class CfDeliveryAdapter implements ContinuationDeliveryAdapter {
  constructor(private readonly options: CfDeliveryAdapterOptions = {}) {}

  async deliver(input: ContinuationDeliveryInput): Promise<ContinuationDeliveryResult> {
    const target = input.continuation.delivery.target as CfDeliveryTarget | undefined;
    if (!target?.kind) {
      return { delivered: false, failureReason: 'missing_delivery_target' };
    }

    try {
      switch (target.kind) {
        case 'slack':
          if (!this.options.slack) {
            return { delivered: false, failureReason: 'no_slack_handler' };
          }
          await this.options.slack(target, input);
          return { delivered: true };
        case 'github':
          if (!this.options.github) {
            return { delivered: false, failureReason: 'no_github_handler' };
          }
          await this.options.github(target, input);
          return { delivered: true };
        case 'a2a-callback':
          if (!this.options.a2aCallback) {
            return { delivered: false, failureReason: 'no_a2a_callback_handler' };
          }
          await this.options.a2aCallback(target, input);
          return { delivered: true };
        default: {
          // Unknown / future delivery target kind. Don't silently succeed.
          const unknownKind = (target as { kind?: string }).kind;
          return {
            delivered: false,
            failureReason: `unsupported_target_kind:${unknownKind ?? 'unknown'}`,
          };
        }
      }
    } catch (error) {
      return {
        delivered: false,
        failureReason: error instanceof Error ? error.message : 'delivery_failed',
      };
    }
  }
}
