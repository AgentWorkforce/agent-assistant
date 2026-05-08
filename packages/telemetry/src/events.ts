import { randomUUID } from 'node:crypto';
import type {
  TelemetryBoundedMetadata,
  TelemetryEvent,
  TelemetryEventBase,
  TelemetryRuntimePolicyEvent,
  TelemetrySubagentBatchStartedEvent,
  TelemetrySubagentFailedEvent,
  TelemetrySubagentFinishedEvent,
  TelemetrySubagentStartedEvent,
  TelemetryTurnFinishedEvent,
} from './sinks/types.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_STRING_LENGTH = 256;
const MAX_METADATA_ARRAY_LENGTH = 32;
const textEncoder = new TextEncoder();

const FORBIDDEN_METADATA_KEYS = new Set([
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
]);

type TelemetryEventWithOptionalId<T extends TelemetryEvent> = Omit<T, 'eventId'> & {
  eventId?: string;
};

type TelemetryRuntimePolicyEventInput = Omit<
  TelemetryRuntimePolicyEvent,
  'eventId' | 'eventKind'
> & {
  eventId?: string;
};

type TelemetrySubagentEventInput<
  T extends
    | TelemetrySubagentStartedEvent
    | TelemetrySubagentFinishedEvent
    | TelemetrySubagentFailedEvent,
> = Omit<T, 'eventId' | 'eventKind'> & {
  eventId?: string;
};

type TelemetrySubagentBatchStartedEventInput = Omit<
  TelemetrySubagentBatchStartedEvent,
  'eventId' | 'eventKind' | 'batchSize'
> & {
  eventId?: string;
  batchSize?: number;
};

export interface TelemetryEventConstructorOptions {
  generateEventId?(): string;
  maxPayloadBytes?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function assertIdentifier(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${fieldName} must be a non-empty string <= ${MAX_IDENTIFIER_LENGTH} chars`);
  }
}

function assertNonNegativeInteger(
  value: number | undefined,
  fieldName: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer when provided`);
  }
}

function assertTelemetryTimestamp(value: unknown): asserts value is string {
  assertIdentifier(value, 'timestamp');
}

function assertSafeMetadataValue(value: unknown, fieldName: string): void {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'string') {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      throw new Error(
        `${fieldName} string values must be <= ${MAX_METADATA_STRING_LENGTH} chars`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ARRAY_LENGTH) {
      throw new Error(
        `${fieldName} arrays must be <= ${MAX_METADATA_ARRAY_LENGTH} items`,
      );
    }
    for (const [index, item] of value.entries()) {
      assertSafeMetadataValue(item, `${fieldName}[${index}]`);
      if (Array.isArray(item) || isPlainObject(item)) {
        throw new Error(`${fieldName} arrays may contain only scalar values`);
      }
    }
    return;
  }

  throw new Error(`${fieldName} must contain only bounded scalar values`);
}

function assertSafeMetadata(metadata: unknown): asserts metadata is TelemetryBoundedMetadata {
  if (metadata === undefined) {
    return;
  }
  if (!isPlainObject(metadata)) {
    throw new Error('metadata must be a plain object when provided');
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) {
      throw new Error(`metadata keys must be 1-${MAX_METADATA_KEY_LENGTH} chars`);
    }
    if (FORBIDDEN_METADATA_KEYS.has(normalizeMetadataKey(key))) {
      throw new Error(`metadata key "${key}" is not allowed in privacy-safe telemetry events`);
    }
    assertSafeMetadataValue(value, `metadata.${key}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }

  if (isPlainObject(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    return Object.freeze(value);
  }

  return value;
}

function assertPayloadSize(event: TelemetryEvent, maxPayloadBytes: number): void {
  const payloadBytes = textEncoder.encode(JSON.stringify(event)).byteLength;
  if (payloadBytes > maxPayloadBytes) {
    throw new Error(
      `Telemetry event payload ${payloadBytes} bytes exceeds max ${maxPayloadBytes} bytes`,
    );
  }
}

function finalizeEvent<T extends TelemetryEvent>(
  event: T,
  options: TelemetryEventConstructorOptions = {},
): T {
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  assertPayloadSize(event, maxPayloadBytes);
  return deepFreeze(event);
}

function withEventId<T extends TelemetryEventBase>(
  event: Omit<T, 'eventId'> & { eventId?: string },
  options: TelemetryEventConstructorOptions,
): T {
  const eventId = event.eventId ?? options.generateEventId?.() ?? randomUUID();
  assertIdentifier(eventId, 'eventId');
  assertIdentifier(event.assistantId, 'assistantId');
  assertIdentifier(event.turnId, 'turnId');
  assertTelemetryTimestamp(event.timestamp);
  if (event.parentTraceId !== undefined) {
    assertIdentifier(event.parentTraceId, 'parentTraceId');
  }
  assertNonNegativeInteger(event.durationMs, 'durationMs');
  return {
    ...event,
    eventId,
  } as T;
}

function finalizeRuntimePolicyEvent<T extends TelemetryRuntimePolicyEvent>(
  input: TelemetryEventWithOptionalId<T>,
  options: TelemetryEventConstructorOptions = {},
): T {
  assertIdentifier(input.reason, 'reason');
  if (input.toolName !== undefined) {
    assertIdentifier(input.toolName, 'toolName');
  }
  assertSafeMetadata(input.metadata);
  return finalizeEvent(withEventId(input, options), options);
}

function finalizeSubagentEvent<
  T extends
    | TelemetrySubagentStartedEvent
    | TelemetrySubagentFinishedEvent
    | TelemetrySubagentFailedEvent,
>(
  input: TelemetrySubagentEventInput<T>,
  eventKind: T['eventKind'],
  options: TelemetryEventConstructorOptions = {},
): T {
  assertIdentifier(input.subagentName, 'subagentName');
  assertIdentifier(input.childTraceId, 'childTraceId');
  assertNonNegativeInteger(input.iterations, 'iterations');
  assertNonNegativeInteger(input.toolCallCount, 'toolCallCount');
  if (input.stopReason !== undefined) {
    assertIdentifier(input.stopReason, 'stopReason');
  }
  return finalizeEvent(
    withEventId(
      {
        ...input,
        eventKind,
      } as Omit<T, 'eventId'> & { eventId?: string },
      options,
    ),
    options,
  );
}

export function createSubagentBatchStartedEvent(
  input: TelemetrySubagentBatchStartedEventInput,
  options: TelemetryEventConstructorOptions = {},
): TelemetrySubagentBatchStartedEvent {
  if (input.subagentNames.length === 0) {
    throw new Error('subagentNames must contain at least one subagent');
  }
  if (input.subagentNames.length !== input.childTraceIds.length) {
    throw new Error('subagentNames and childTraceIds must have the same length');
  }
  for (const name of input.subagentNames) {
    assertIdentifier(name, 'subagentNames[]');
  }
  for (const childTraceId of input.childTraceIds) {
    assertIdentifier(childTraceId, 'childTraceIds[]');
  }
  const normalizedInput: Omit<TelemetrySubagentBatchStartedEvent, 'eventId'> & { eventId?: string } = {
    ...input,
    eventKind: 'subagent.batch.started',
    batchSize: input.batchSize ?? input.subagentNames.length,
  };
  assertNonNegativeInteger(normalizedInput.batchSize, 'batchSize');
  if (normalizedInput.batchSize !== input.subagentNames.length) {
    throw new Error('batchSize must match the number of subagentNames');
  }
  return finalizeEvent(withEventId(normalizedInput, options), options);
}

export function createSubagentStartedEvent(
  input: TelemetrySubagentEventInput<TelemetrySubagentStartedEvent>,
  options: TelemetryEventConstructorOptions = {},
): TelemetrySubagentStartedEvent {
  return finalizeSubagentEvent(input, 'subagent.started', options);
}

export function createSubagentFinishedEvent(
  input: TelemetrySubagentEventInput<TelemetrySubagentFinishedEvent>,
  options: TelemetryEventConstructorOptions = {},
): TelemetrySubagentFinishedEvent {
  return finalizeSubagentEvent(input, 'subagent.finished', options);
}

export function createSubagentFailedEvent(
  input: TelemetrySubagentEventInput<TelemetrySubagentFailedEvent>,
  options: TelemetryEventConstructorOptions = {},
): TelemetrySubagentFailedEvent {
  return finalizeSubagentEvent(input, 'subagent.failed', options);
}

export function createRuntimePolicyBlockedEvent(
  input: TelemetryRuntimePolicyEventInput,
  options: TelemetryEventConstructorOptions = {},
): TelemetryRuntimePolicyEvent {
  return finalizeRuntimePolicyEvent(
    {
      ...input,
      eventKind: 'runtime_policy.blocked',
    },
    options,
  );
}

export function createRuntimePolicyCacheHitEvent(
  input: TelemetryRuntimePolicyEventInput,
  options: TelemetryEventConstructorOptions = {},
): TelemetryRuntimePolicyEvent {
  return finalizeRuntimePolicyEvent(
    {
      ...input,
      eventKind: 'runtime_policy.cache_hit',
    },
    options,
  );
}

export function createRuntimePolicyOutputSanitizedEvent(
  input: TelemetryRuntimePolicyEventInput,
  options: TelemetryEventConstructorOptions = {},
): TelemetryRuntimePolicyEvent {
  return finalizeRuntimePolicyEvent(
    {
      ...input,
      eventKind: 'runtime_policy.output_sanitized',
    },
    options,
  );
}

export function createSynthesisSalvagedEvent(
  input: TelemetryRuntimePolicyEventInput,
  options: TelemetryEventConstructorOptions = {},
): TelemetryRuntimePolicyEvent {
  return finalizeRuntimePolicyEvent(
    {
      ...input,
      eventKind: 'synthesis.salvaged',
    },
    options,
  );
}

export type { TelemetryTurnFinishedEvent };
