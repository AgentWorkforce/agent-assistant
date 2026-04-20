import type { HarnessAggregateUsage, HarnessTranscriptItem } from '@agent-assistant/harness';

export interface TelemetryEventCostBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
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
  output: { kind: 'final_answer' | 'failed' | 'refused'; text?: string; stopReason?: string };
  transcript: HarnessTranscriptItem[];
  usage: HarnessAggregateUsage;
  cost: { usd: number; perModel: TelemetryEventCostBreakdown[] };
  metadata?: Record<string, unknown>;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): Promise<void> | void;
}
