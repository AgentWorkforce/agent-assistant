import type { HarnessAggregateUsage, HarnessTranscriptItem } from '@agent-assistant/harness';

export type TelemetryOutputKind =
  | 'final_answer'
  | 'failed'
  | 'refused'
  | 'deferred'
  | 'clarification'
  | 'approval';

export interface TelemetryEventCostBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  missingPricing: boolean;
}

export interface TelemetryEventCost {
  usd: number;
  missingPricing: boolean;
  perModel: TelemetryEventCostBreakdown[];
}

export interface TelemetryEvent {
  eventId: string;
  eventKind: 'turn.finished';
  timestamp: string;
  assistantId: string;
  turnId: string;
  threadId?: string;
  userId?: string;
  input: { message: string; systemPrompt?: string };
  output: { kind: TelemetryOutputKind; text?: string; stopReason?: string };
  transcript: HarnessTranscriptItem[];
  usage: HarnessAggregateUsage;
  cost: TelemetryEventCost;
  metadata?: Record<string, unknown>;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): Promise<void> | void;
}
