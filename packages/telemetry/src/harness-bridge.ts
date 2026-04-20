import { randomUUID } from 'node:crypto';
import type {
  HarnessExecutionState,
  HarnessResult,
  HarnessTranscriptItem,
  HarnessUsage,
} from '@agent-assistant/harness';
import { computeCost } from './cost.js';
import { FROZEN_PRICING_TABLE } from './pricing.js';
import type { PricingTable } from './pricing.js';
import type { TelemetrySink, TelemetryEvent } from './sinks/types.js';

export interface TelemetryHookOptions {
  sink: TelemetrySink;
  pricingTable?: PricingTable;
  inputMessageFor?(state: HarnessExecutionState): { message: string; systemPrompt?: string };
  metadataFor?(state: HarnessExecutionState): Record<string, unknown> | undefined;
  generateEventId?(): string;
}

type ExposedHarnessState = HarnessExecutionState & {
  userId?: string;
  threadId?: string;
  input?: {
    message?: { text?: unknown } | unknown;
    instructions?: { systemPrompt?: unknown } | unknown;
  };
  transcript?: unknown;
  modelCalls?: unknown;
};

type ModelCallLike = {
  model?: unknown;
  modelId?: unknown;
  usage?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
};

export function createTelemetryHook(
  options: TelemetryHookOptions,
): (result: HarnessResult, state: HarnessExecutionState) => Promise<void> {
  const pricingTable = options.pricingTable ?? FROZEN_PRICING_TABLE;

  return async (result, state) => {
    try {
      const exposedState = state as ExposedHarnessState;
      const event: TelemetryEvent = {
        eventId: options.generateEventId?.() ?? randomUUID(),
        eventKind: 'turn.finished',
        timestamp: new Date().toISOString(),
        assistantId: state.assistantId,
        turnId: result.turnId || state.turnId,
        threadId: exposedState.threadId,
        userId: exposedState.userId,
        input: options.inputMessageFor?.(state) ?? defaultInputFor(exposedState),
        output: outputFor(result),
        transcript: transcriptFor(exposedState),
        usage: result.usage,
        cost: costFor(exposedState, pricingTable),
        metadata: metadataFor(result, state, options),
      };

      await options.sink.emit(event);
    } catch (error) {
      console.warn('Telemetry hook failed to emit turn.finished event', error);
    }
  };
}

function defaultInputFor(state: ExposedHarnessState): TelemetryEvent['input'] {
  const message = state.input?.message;
  const instructions = state.input?.instructions;
  const text =
    isRecord(message) && typeof message.text === 'string'
      ? message.text
      : typeof message === 'string'
        ? message
        : '';
  const systemPrompt =
    isRecord(instructions) && typeof instructions.systemPrompt === 'string'
      ? instructions.systemPrompt
      : undefined;

  return systemPrompt === undefined
    ? { message: text }
    : { message: text, systemPrompt };
}

function outputFor(result: HarnessResult): TelemetryEvent['output'] {
  if (result.stopReason === 'model_refused') {
    return {
      kind: 'refused',
      text: result.assistantMessage?.text,
      stopReason: result.stopReason,
    };
  }

  if (result.outcome === 'failed') {
    return {
      kind: 'failed',
      text: result.assistantMessage?.text,
      stopReason: result.stopReason,
    };
  }

  return {
    kind: 'final_answer',
    text: result.assistantMessage?.text,
    stopReason: result.stopReason,
  };
}

function transcriptFor(state: ExposedHarnessState): HarnessTranscriptItem[] {
  // HarnessExecutionState currently exposes only counters and IDs. The runtime keeps
  // transcript internally, so prefer an enriched state.transcript when present and
  // fall back to [] rather than serializing result.traceSummary, which omits content.
  return Array.isArray(state.transcript)
    ? (state.transcript as HarnessTranscriptItem[])
    : [];
}

function costFor(
  state: ExposedHarnessState,
  pricingTable: PricingTable,
): TelemetryEvent['cost'] {
  const perModel = modelCallsFor(state).map((call) => {
    const model = modelIdFor(call);
    const usage = usageFor(call);
    const cost = computeCost(usage, model, pricingTable);

    return {
      model,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      usd: cost.usd,
    };
  });

  return {
    usd: perModel.reduce((total, item) => total + item.usd, 0),
    perModel,
  };
}

function modelCallsFor(state: ExposedHarnessState): ModelCallLike[] {
  if (Array.isArray(state.modelCalls)) {
    return state.modelCalls.filter(isRecord) as ModelCallLike[];
  }

  return transcriptFor(state)
    .filter((item) => item.type === 'assistant_step')
    .map((item) => metadataModelCallFor(item.metadata))
    .filter((call): call is ModelCallLike => call !== undefined);
}

function metadataModelCallFor(metadata: Record<string, unknown> | undefined): ModelCallLike | undefined {
  if (!metadata) {
    return undefined;
  }

  const model = firstString(metadata.modelId, metadata.model);
  const usage = isRecord(metadata.usage) ? metadata.usage : undefined;

  if (model === undefined && usage === undefined) {
    return undefined;
  }

  return { model, usage };
}

function modelIdFor(call: ModelCallLike): string {
  return firstString(call.modelId, call.model) ?? 'unknown';
}

function usageFor(call: ModelCallLike): Pick<HarnessUsage, 'inputTokens' | 'outputTokens'> {
  const usage = isRecord(call.usage) ? call.usage : undefined;

  return {
    inputTokens: firstNumber(
      usage?.inputTokens,
      usage?.promptTokens,
      call.inputTokens,
      call.promptTokens,
    ),
    outputTokens: firstNumber(
      usage?.outputTokens,
      usage?.completionTokens,
      call.outputTokens,
      call.completionTokens,
    ),
  };
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

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
