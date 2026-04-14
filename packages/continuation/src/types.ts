import type {
  HarnessContinuation,
  HarnessResult,
  HarnessUserMessage,
} from '@agent-assistant/harness';

// ─── Re-export harness types used by consumers ───────────────────────────────

export type { HarnessContinuation, HarnessResult, HarnessUserMessage };

// ─── Status ───────────────────────────────────────────────────────────────────

export type ContinuationStatus =
  | 'pending'
  | 'resuming'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'superseded'
  | 'failed';

// ─── Terminal reasons ─────────────────────────────────────────────────────────

export type ContinuationTerminalReason =
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_product'
  | 'expired_ttl'
  | 'superseded_by_newer_turn'
  | 'approval_denied'
  | 'invalid_resume_trigger'
  | 'max_resume_attempts_reached'
  | 'resume_runtime_error'
  | 'delivery_failed'
  | 'session_no_longer_deliverable';

// ─── Wait conditions ──────────────────────────────────────────────────────────

export type ContinuationWaitCondition =
  | { type: 'user_reply'; correlationKey?: string }
  | { type: 'approval_resolution'; approvalId: string }
  | { type: 'external_result'; operationId: string }
  | { type: 'scheduled_wake'; wakeUpId?: string };

// ─── Resume triggers ──────────────────────────────────────────────────────────

export type ContinuationResumeTrigger =
  | {
      type: 'user_reply';
      message: HarnessUserMessage;
      receivedAt: string;
    }
  | {
      type: 'approval_resolution';
      approvalId: string;
      decision: 'approved' | 'denied';
      resolvedAt: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'external_result';
      operationId: string;
      resolvedAt: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'scheduled_wake';
      wakeUpId?: string;
      firedAt: string;
    };

// ─── Origin ───────────────────────────────────────────────────────────────────

export interface ContinuationOrigin {
  turnId: string;
  outcome: 'needs_clarification' | 'awaiting_approval' | 'deferred';
  stopReason: string;
  createdAt: string;
}

// ─── Bounds ───────────────────────────────────────────────────────────────────

export interface ContinuationBounds {
  expiresAt: string;
  maxResumeAttempts: number;
  resumeAttempts: number;
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export interface ContinuationDeliveryTarget {
  surfaceIds?: string[];
  fanoutMode?: 'originating_surface' | 'attached_surfaces' | 'product_defined';
  suppressIfSessionReengaged?: boolean;
}

export type ContinuationDeliveryStatus =
  | 'not_applicable'
  | 'pending_delivery'
  | 'delivered'
  | 'suppressed_session_reengaged'
  | 'suppressed_superseded'
  | 'suppressed_expired'
  | 'delivery_failed';

export interface ContinuationDeliveryState {
  target?: ContinuationDeliveryTarget;
  status: ContinuationDeliveryStatus;
  lastDeliveryAttemptAt?: string;
  deliveredAt?: string;
}

// ─── Core record ──────────────────────────────────────────────────────────────

export interface ContinuationRecord {
  id: string;
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;

  origin: ContinuationOrigin;
  status: ContinuationStatus;
  waitFor: ContinuationWaitCondition;
  continuation: HarnessContinuation;
  delivery: ContinuationDeliveryState;
  bounds: ContinuationBounds;

  createdAt: string;
  updatedAt: string;
  lastResumedAt?: string;
  terminalReason?: ContinuationTerminalReason;
  metadata?: Record<string, unknown>;
}

// ─── Adapter interfaces ───────────────────────────────────────────────────────

export interface ContinuationStore {
  put(record: ContinuationRecord): Promise<void>;
  get(continuationId: string): Promise<ContinuationRecord | null>;
  delete?(continuationId: string): Promise<void>;
  listBySession?(sessionId: string): Promise<ContinuationRecord[]>;
}

export interface ContinuationResumedTurnInput {
  continuation: ContinuationRecord;
  trigger: ContinuationResumeTrigger;
  resumedTurnId: string;
}

export interface ContinuationHarnessAdapter {
  runResumedTurn(input: ContinuationResumedTurnInput): Promise<HarnessResult>;
}

export interface ContinuationDeliveryInput {
  continuation: ContinuationRecord;
  harnessResult: HarnessResult;
}

export interface ContinuationDeliveryResult {
  delivered: boolean;
  failureReason?: string;
}

export interface ContinuationDeliveryAdapter {
  deliver(input: ContinuationDeliveryInput): Promise<ContinuationDeliveryResult>;
}

export interface ContinuationSchedulerAdapter {
  scheduleWake(input: {
    continuationId: string;
    wakeAtMs: number;
  }): Promise<{ wakeUpId: string }>;
  cancelWake?(wakeUpId: string): Promise<void>;
}

export interface ContinuationClock {
  nowMs(): number;
  nowIso(): string;
}

// ─── Trace ────────────────────────────────────────────────────────────────────

export type ContinuationTraceEvent =
  | {
      type: 'continuation_created';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      outcome: string;
      waitFor: string;
      status: ContinuationStatus;
      timestamp: string;
    }
  | {
      type: 'continuation_creation_rejected';
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      reason: string;
      timestamp: string;
    }
  | {
      type: 'continuation_resume_requested';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      triggerType: string;
      status: ContinuationStatus;
      timestamp: string;
    }
  | {
      type: 'continuation_resume_rejected';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      reason: string;
      timestamp: string;
    }
  | {
      type: 'continuation_resumed_turn_started';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      resumedTurnId: string;
      timestamp: string;
    }
  | {
      type: 'continuation_resumed_turn_finished';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      resumedTurnId: string;
      harnessOutcome: string;
      timestamp: string;
    }
  | {
      type: 'continuation_delivery_attempted';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      timestamp: string;
    }
  | {
      type: 'continuation_delivery_finalized';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      deliveryStatus: ContinuationDeliveryStatus;
      timestamp: string;
    }
  | {
      type: 'continuation_terminated';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      status: ContinuationStatus;
      terminalReason: ContinuationTerminalReason;
      timestamp: string;
    }
  | {
      type: 'continuation_expired';
      continuationId: string;
      assistantId: string;
      sessionId?: string;
      originTurnId: string;
      timestamp: string;
    };

export interface ContinuationTraceSink {
  emit(event: ContinuationTraceEvent): void;
}

// ─── Config and defaults ──────────────────────────────────────────────────────

export interface ContinuationDefaults {
  /** TTL in ms for needs_clarification outcomes. Default: 3_600_000 (1 hour) */
  clarificationTtlMs?: number;
  /** TTL in ms for awaiting_approval outcomes. Default: 86_400_000 (24 hours) */
  approvalTtlMs?: number;
  /** TTL in ms for deferred outcomes. Default: 3_600_000 (1 hour) */
  deferredTtlMs?: number;
  /** TTL in ms for scheduled_wake deferred outcomes. Default: 3_600_000 (1 hour) */
  scheduledWakeTtlMs?: number;
  /** Max resume attempts per record. Default: 3 */
  maxResumeAttempts?: number;
}

export interface ContinuationConfig {
  store: ContinuationStore;
  harness: ContinuationHarnessAdapter;
  delivery?: ContinuationDeliveryAdapter;
  scheduler?: ContinuationSchedulerAdapter;
  clock?: ContinuationClock;
  trace?: ContinuationTraceSink;
  defaults?: ContinuationDefaults;
}

// ─── Input/output contracts ───────────────────────────────────────────────────

export interface CreateContinuationInput {
  assistantId: string;
  sessionId?: string;
  threadId?: string;
  userId?: string;

  originTurnId: string;
  harnessResult: HarnessResult;

  delivery?: ContinuationDeliveryTarget;
  bounds?: Partial<ContinuationBounds>;
  metadata?: Record<string, unknown>;
}

export interface ResumeContinuationInput {
  continuationId: string;
  trigger: ContinuationResumeTrigger;
  metadata?: Record<string, unknown>;
}

export interface StopContinuationInput {
  continuationId: string;
  reason: ContinuationTerminalReason;
  metadata?: Record<string, unknown>;
}

export interface ContinuationCreateResult {
  continuation: ContinuationRecord;
  scheduledWakeId?: string;
}

export interface ContinuationResumeResult {
  continuation: ContinuationRecord;
  harnessResult: HarnessResult;
  delivered: boolean;
}

export interface ContinuationStopResult {
  continuation: ContinuationRecord;
}

// ─── Runtime interface ────────────────────────────────────────────────────────

export interface ContinuationRuntime {
  create(input: CreateContinuationInput): Promise<ContinuationCreateResult>;
  resume(input: ResumeContinuationInput): Promise<ContinuationResumeResult>;
  stop(input: StopContinuationInput): Promise<ContinuationStopResult>;
  get(input: { continuationId: string }): Promise<ContinuationRecord | null>;
}

// ─── Error classes ────────────────────────────────────────────────────────────

export class ContinuationError extends Error {
  constructor(
    message: string,
    public readonly continuationId?: string,
  ) {
    super(message);
    this.name = 'ContinuationError';
  }
}

export class ContinuationNotFoundError extends ContinuationError {
  constructor(continuationId: string) {
    super(`Continuation not found: ${continuationId}`, continuationId);
    this.name = 'ContinuationNotFoundError';
  }
}

export class ContinuationExpiredError extends ContinuationError {
  constructor(continuationId: string, expiresAt: string) {
    super(`Continuation ${continuationId} expired at ${expiresAt}`, continuationId);
    this.name = 'ContinuationExpiredError';
  }
}

export class ContinuationAlreadyTerminalError extends ContinuationError {
  constructor(continuationId: string, status: ContinuationStatus) {
    super(
      `Continuation ${continuationId} is already in terminal status: ${status}`,
      continuationId,
    );
    this.name = 'ContinuationAlreadyTerminalError';
  }
}

export class ContinuationTriggerMismatchError extends ContinuationError {
  constructor(
    continuationId: string,
    expected: string,
    received: string,
  ) {
    super(
      `Continuation ${continuationId} expects trigger type '${expected}' but received '${received}'`,
      continuationId,
    );
    this.name = 'ContinuationTriggerMismatchError';
  }
}

export class ContinuationInvalidInputError extends ContinuationError {
  constructor(message: string, continuationId?: string) {
    super(message, continuationId);
    this.name = 'ContinuationInvalidInputError';
  }
}
