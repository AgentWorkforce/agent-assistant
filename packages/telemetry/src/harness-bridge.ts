import { randomUUID } from 'node:crypto';
import type {
  HarnessExecutionState,
  HarnessModelCallRecord,
  HarnessResult,
  HarnessTranscriptItem,
  HarnessUsage,
} from '@agent-assistant/harness';
import { computeCost } from './cost.js';
import { FROZEN_PRICING_TABLE } from './pricing.js';
import type { PricingTable } from './pricing.js';
import type {
  TelemetryEvent,
  TelemetryEventCost,
  TelemetryOutputKind,
  TelemetrySink,
} from './sinks/types.js';

export interface TelemetryHookOptions {
  sink: TelemetrySink;
  pricingTable?: PricingTable;
  inputMessageFor?(state: HarnessExecutionState): { message: string; systemPrompt?: string };
  metadataFor?(state: HarnessExecutionState): Record<string, unknown> | undefined;
  generateEventId?(): string;
}

export function createTelemetryHook(
  options: TelemetryHookOptions,
): (result: HarnessResult, state: HarnessExecutionState) => Promise<void> {
  const pricingTable = options.pricingTable ?? FROZEN_PRICING_TABLE;

  return async (result, state) => {
    try {
      const event: TelemetryEvent = {
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

function defaultInputFor(state: HarnessExecutionState): TelemetryEvent['input'] {
  const message = state.input?.message?.text ?? '';
  const systemPrompt = state.input?.instructions?.systemPrompt;

  return systemPrompt === undefined ? { message } : { message, systemPrompt };
}

function outputFor(result: HarnessResult): TelemetryEvent['output'] {
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
