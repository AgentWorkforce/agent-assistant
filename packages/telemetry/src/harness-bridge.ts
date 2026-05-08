import { randomUUID } from 'node:crypto';
import type {
  HarnessExecutionState,
  HarnessModelCallRecord,
  HarnessResult,
  HarnessTraceEvent,
  HarnessTraceSink,
  HarnessTranscriptItem,
  HarnessUsage,
} from '@agent-assistant/harness';
import { computeCost } from './cost.js';
import {
  createRuntimePolicyBlockedEvent,
  createRuntimePolicyCacheHitEvent,
  createRuntimePolicyOutputSanitizedEvent,
  createSubagentFailedEvent,
  createSubagentFinishedEvent,
  createSubagentStartedEvent,
  createSynthesisSalvagedEvent,
  type TelemetryEventConstructorOptions,
} from './events.js';
import { FROZEN_PRICING_TABLE } from './pricing.js';
import type { PricingTable } from './pricing.js';
import type {
  TelemetryBoundedMetadata,
  TelemetryEvent,
  TelemetryEventCost,
  TelemetryOutputKind,
  TelemetrySink,
  TelemetryTurnFinishedEvent,
} from './sinks/types.js';

export interface TelemetryHookOptions {
  sink: TelemetrySink;
  pricingTable?: PricingTable;
  inputMessageFor?(state: HarnessExecutionState): { message: string; systemPrompt?: string };
  metadataFor?(state: HarnessExecutionState): Record<string, unknown> | undefined;
  generateEventId?(): string;
}

export interface TelemetryTraceBridgeOptions extends TelemetryEventConstructorOptions {
  sink: TelemetrySink;
}

type TelemetryTraceBridgeEvent = Extract<
  HarnessTraceEvent,
  | { type: 'turn_started' }
  | { type: 'turn_finished' }
>;

interface RuntimePolicyTraceBridgeEvent {
  type:
    | 'runtime_policy.blocked'
    | 'runtime_policy.cache_hit'
    | 'runtime_policy.todo_rewrite_blocked'
    | 'runtime_policy.output_sanitized'
    | 'runtime_policy.synthesis_salvaged';
  timestamp: string;
  assistantId: string;
  turnId: string;
  elapsedMs?: number;
  toolName?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

type TelemetryBridgeInputEvent = TelemetryTraceBridgeEvent | RuntimePolicyTraceBridgeEvent;

export function createTelemetryHook(
  options: TelemetryHookOptions,
): (result: HarnessResult, state: HarnessExecutionState) => Promise<void> {
  const pricingTable = options.pricingTable ?? FROZEN_PRICING_TABLE;

  return async (result, state) => {
    try {
      const event: TelemetryTurnFinishedEvent = {
        eventId: options.generateEventId?.() ?? randomUUID(),
        eventKind: 'turn.finished',
        timestamp: new Date().toISOString(),
        assistantId: state.assistantId,
        turnId: result.turnId || state.turnId,
        threadId: state.threadId,
        userId: state.userId,
        input: options.inputMessageFor?.(state) ?? defaultInputFor(state),
        output: outputFor(result),
        transcript: transcriptFor(state),
        usage: result.usage,
        cost: costFor(state, pricingTable),
        metadata: metadataFor(result, state, options),
      };

      await options.sink.emit(event);
    } catch (error) {
      console.warn('Telemetry hook failed to emit turn.finished event', error);
    }
  };
}

export function createTelemetryTraceBridge(options: TelemetryTraceBridgeOptions): HarnessTraceSink {
  return {
    async emit(event) {
      try {
        const telemetryEvents = telemetryEventsFromTraceEvent(event, options);
        for (const telemetryEvent of telemetryEvents) {
          await options.sink.emit(telemetryEvent);
        }
      } catch (error) {
        console.warn('Telemetry trace bridge failed to emit telemetry event', error);
      }
    },
  };
}

export function telemetryEventsFromTraceEvent(
  event: HarnessTraceEvent | RuntimePolicyTraceBridgeEvent,
  options: TelemetryEventConstructorOptions = {},
): TelemetryEvent[] {
  if (!isBridgeEvent(event)) {
    return [];
  }

  if (event.type === 'turn_started') {
    const subagentMetadata = readSubagentTraceMetadata(event.metadata);
    if (!subagentMetadata) {
      return [];
    }

    return [
      createSubagentStartedEvent(
        {
          timestamp: event.timestamp,
          assistantId: event.assistantId,
          turnId: event.turnId,
          parentTraceId: subagentMetadata.parentTraceId,
          durationMs: event.elapsedMs,
          subagentName: subagentMetadata.subagentName,
          childTraceId: subagentMetadata.childTraceId,
          toolCallCount: event.toolCallCount,
        },
        options,
      ),
    ];
  }

  if (event.type === 'turn_finished') {
    const subagentMetadata = readSubagentTraceMetadata(event.metadata);
    if (!subagentMetadata) {
      return [];
    }

    return [
      event.outcome === 'completed' && event.stopReason === 'answer_finalized'
        ? createSubagentFinishedEvent(
            {
              timestamp: event.timestamp,
              assistantId: event.assistantId,
              turnId: event.turnId,
              parentTraceId: subagentMetadata.parentTraceId,
              durationMs: event.elapsedMs,
              subagentName: subagentMetadata.subagentName,
              childTraceId: subagentMetadata.childTraceId,
              iterations: event.iteration,
              stopReason: event.stopReason,
              toolCallCount: event.toolCallCount,
            },
            options,
          )
        : createSubagentFailedEvent(
            {
              timestamp: event.timestamp,
              assistantId: event.assistantId,
              turnId: event.turnId,
              parentTraceId: subagentMetadata.parentTraceId,
              durationMs: event.elapsedMs,
              subagentName: subagentMetadata.subagentName,
              childTraceId: subagentMetadata.childTraceId,
              iterations: event.iteration,
              stopReason: event.stopReason,
              toolCallCount: event.toolCallCount,
            },
            options,
          ),
    ];
  }

  if (!isRuntimePolicyBridgeEvent(event)) {
    return [];
  }

  const metadata = toBoundedMetadata(event.metadata);
  const baseInput = {
    timestamp: event.timestamp,
    assistantId: event.assistantId,
    turnId: event.turnId,
    parentTraceId: readParentTraceId(event.metadata),
    durationMs: event.elapsedMs,
    toolName: event.toolName,
    reason: event.reason,
    ...(metadata ? { metadata } : {}),
  } as const;

  switch (event.type) {
    case 'runtime_policy.blocked':
    case 'runtime_policy.todo_rewrite_blocked':
      return [createRuntimePolicyBlockedEvent(baseInput, options)];
    case 'runtime_policy.cache_hit':
      return [createRuntimePolicyCacheHitEvent(baseInput, options)];
    case 'runtime_policy.output_sanitized':
      return [createRuntimePolicyOutputSanitizedEvent(baseInput, options)];
    case 'runtime_policy.synthesis_salvaged':
      return [createSynthesisSalvagedEvent(baseInput, options)];
    default:
      return [];
  }
}

function defaultInputFor(state: HarnessExecutionState): TelemetryTurnFinishedEvent['input'] {
  const message = state.input?.message?.text ?? '';
  const systemPrompt = state.input?.instructions?.systemPrompt;

  return systemPrompt === undefined ? { message } : { message, systemPrompt };
}

function outputFor(result: HarnessResult): TelemetryTurnFinishedEvent['output'] {
  const text = result.assistantMessage?.text;
  const stopReason = result.stopReason;

  if (stopReason === 'model_refused') {
    return { kind: 'refused', text, stopReason };
  }

  const kind = kindForOutcome(result.outcome);
  return { kind, text, stopReason };
}

function kindForOutcome(outcome: HarnessResult['outcome']): TelemetryOutputKind {
  switch (outcome) {
    case 'completed':
      return 'final_answer';
    case 'needs_clarification':
      return 'clarification';
    case 'awaiting_approval':
      return 'approval';
    case 'deferred':
      return 'deferred';
    case 'failed':
      return 'failed';
  }
}

function transcriptFor(state: HarnessExecutionState): HarnessTranscriptItem[] {
  return state.transcript ?? [];
}

function costFor(
  state: HarnessExecutionState,
  pricingTable: PricingTable,
): TelemetryEventCost {
  const perModel = modelCallsFor(state).map((call) => {
    const model = call.modelId ?? 'unknown';
    const usage = call.usage ?? {};
    const cost = computeCost(usage, model, pricingTable);

    return {
      model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      usd: cost.usd,
      missingPricing: cost.missingPricing,
    };
  });

  return {
    usd: perModel.reduce((total, item) => total + item.usd, 0),
    missingPricing: perModel.some((item) => item.missingPricing),
    perModel,
  };
}

function modelCallsFor(state: HarnessExecutionState): Array<{ modelId?: string; usage?: HarnessUsage }> {
  if (Array.isArray(state.modelCalls) && state.modelCalls.length > 0) {
    return state.modelCalls as HarnessModelCallRecord[];
  }

  return transcriptFor(state)
    .filter((item) => item.type === 'assistant_step')
    .map((item) => metadataModelCallFor(item.metadata))
    .filter((call): call is { modelId?: string; usage?: HarnessUsage } => call !== undefined);
}

function metadataModelCallFor(
  metadata: Record<string, unknown> | undefined,
): { modelId?: string; usage?: HarnessUsage } | undefined {
  if (!metadata) {
    return undefined;
  }

  const modelId = firstString(metadata.modelId, metadata.model);
  const usage = isRecord(metadata.usage) ? (metadata.usage as HarnessUsage) : undefined;

  if (modelId === undefined && usage === undefined) {
    return undefined;
  }

  return { modelId, usage };
}

function metadataFor(
  result: HarnessResult,
  state: HarnessExecutionState,
  options: TelemetryHookOptions,
): Record<string, unknown> {
  return {
    ...options.metadataFor?.(state),
    outcome: result.outcome,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function isBridgeEvent(
  event: HarnessTraceEvent | RuntimePolicyTraceBridgeEvent,
): event is TelemetryBridgeInputEvent {
  switch (event.type) {
    case 'turn_started':
    case 'turn_finished':
    case 'runtime_policy.blocked':
    case 'runtime_policy.cache_hit':
    case 'runtime_policy.todo_rewrite_blocked':
    case 'runtime_policy.output_sanitized':
    case 'runtime_policy.synthesis_salvaged':
      return true;
    default:
      return false;
  }
}

function isRuntimePolicyBridgeEvent(
  event: TelemetryBridgeInputEvent,
): event is RuntimePolicyTraceBridgeEvent {
  switch (event.type) {
    case 'runtime_policy.blocked':
    case 'runtime_policy.cache_hit':
    case 'runtime_policy.todo_rewrite_blocked':
    case 'runtime_policy.output_sanitized':
    case 'runtime_policy.synthesis_salvaged':
      return true;
    default:
      return false;
  }
}

function readParentTraceId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const candidate = metadata.parentTraceId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function readSubagentTraceMetadata(
  metadata: Record<string, unknown> | undefined,
): { parentTraceId?: string; childTraceId: string; subagentName: string } | undefined {
  if (!metadata) {
    return undefined;
  }

  const childTraceId = metadata.childTraceId;
  const subagentName = metadata.subagentName;
  if (
    typeof childTraceId !== 'string' ||
    childTraceId.length === 0 ||
    typeof subagentName !== 'string' ||
    subagentName.length === 0
  ) {
    return undefined;
  }

  const parentTraceId = readParentTraceId(metadata);
  return parentTraceId
    ? { parentTraceId, childTraceId, subagentName }
    : { childTraceId, subagentName };
}

function toBoundedMetadata(
  metadata: Record<string, unknown> | undefined,
): TelemetryBoundedMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const boundedEntries: Array<[string, TelemetryBoundedMetadata[string]]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'parentTraceId' || key === 'childTraceId' || key === 'subagentName') {
      continue;
    }
    if (
      [
        'content',
        'input',
        'inputs',
        'message',
        'messages',
        'output',
        'outputs',
        'prompt',
        'prompts',
        'providercontent',
        'providerresponse',
        'raw',
        'response',
        'text',
        'toolinput',
        'tooloutput',
        'transcript',
      ].includes(normalizeMetadataKey(key))
    ) {
      continue;
    }

    const boundedValue = toBoundedMetadataValue(value);
    if (boundedValue !== undefined) {
      boundedEntries.push([key, boundedValue]);
    }
  }

  return boundedEntries.length > 0 ? Object.freeze(Object.fromEntries(boundedEntries)) : undefined;
}

function toBoundedMetadataValue(
  value: unknown,
): TelemetryBoundedMetadata[string] | undefined {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return isSensitiveMetadataKeyValue(value) ? undefined : value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filtered = value.filter(
    (item): item is string | number | boolean | null =>
      item === null ||
      typeof item === 'boolean' ||
      typeof item === 'number' ||
      (typeof item === 'string' && !isSensitiveMetadataKeyValue(item)),
  );
  return filtered.length > 0 ? Object.freeze(filtered) : undefined;
}

function isSensitiveMetadataKeyValue(value: string): boolean {
  return value.length > 256 || value.includes('\n');
}
