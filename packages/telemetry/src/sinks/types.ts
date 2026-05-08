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

export type TelemetryEventKind =
  | 'turn.finished'
  | 'subagent.batch.started'
  | 'subagent.started'
  | 'subagent.finished'
  | 'subagent.failed'
  | 'runtime_policy.blocked'
  | 'runtime_policy.cache_hit'
  | 'runtime_policy.output_sanitized'
  | 'synthesis.salvaged';

export type TelemetryMetadataScalar = string | number | boolean | null;

export type TelemetryBoundedMetadata = Readonly<
  Record<string, TelemetryMetadataScalar | readonly TelemetryMetadataScalar[]>
>;

export interface TelemetryEventBase {
  eventId: string;
  eventKind: TelemetryEventKind;
  timestamp: string;
  assistantId: string;
  turnId: string;
  parentTraceId?: string;
  durationMs?: number;
}

export interface TelemetryTurnFinishedEvent extends TelemetryEventBase {
  eventKind: 'turn.finished';
  threadId?: string;
  userId?: string;
  input: { message: string; systemPrompt?: string };
  output: { kind: TelemetryOutputKind; text?: string; stopReason?: string };
  transcript: HarnessTranscriptItem[];
  usage: HarnessAggregateUsage;
  cost: TelemetryEventCost;
  metadata?: Record<string, unknown>;
}

export interface TelemetrySubagentBatchStartedEvent extends TelemetryEventBase {
  eventKind: 'subagent.batch.started';
  subagentNames: readonly string[];
  childTraceIds: readonly string[];
  batchSize: number;
}

export interface TelemetrySubagentStartedEvent extends TelemetryEventBase {
  eventKind: 'subagent.started';
  subagentName: string;
  childTraceId: string;
  iterations?: number;
  stopReason?: string;
  toolCallCount?: number;
}

export interface TelemetrySubagentFinishedEvent extends TelemetryEventBase {
  eventKind: 'subagent.finished';
  subagentName: string;
  childTraceId: string;
  iterations?: number;
  stopReason?: string;
  toolCallCount?: number;
}

export interface TelemetrySubagentFailedEvent extends TelemetryEventBase {
  eventKind: 'subagent.failed';
  subagentName: string;
  childTraceId: string;
  iterations?: number;
  stopReason?: string;
  toolCallCount?: number;
}

export interface TelemetryRuntimePolicyEvent extends TelemetryEventBase {
  eventKind:
    | 'runtime_policy.blocked'
    | 'runtime_policy.cache_hit'
    | 'runtime_policy.output_sanitized'
    | 'synthesis.salvaged';
  toolName?: string;
  reason: string;
  metadata?: TelemetryBoundedMetadata;
}

export type TelemetryEvent =
  | TelemetryTurnFinishedEvent
  | TelemetrySubagentBatchStartedEvent
  | TelemetrySubagentStartedEvent
  | TelemetrySubagentFinishedEvent
  | TelemetrySubagentFailedEvent
  | TelemetryRuntimePolicyEvent;

export interface TelemetrySink {
  emit(event: TelemetryEvent): Promise<void> | void;
}
