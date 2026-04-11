import type { RoutingEscalationHook } from '@relay-assistant/routing';

export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';

export type MessageClass =
  | 'attention'
  | 'confidence'
  | 'conflict'
  | 'handoff'
  | 'escalation';

export type SignalClass =
  | 'attention.raise'
  | 'confidence.high'
  | 'confidence.medium'
  | 'confidence.low'
  | 'confidence.blocker'
  | 'conflict.active'
  | 'conflict.resolved'
  | 'handoff.ready'
  | 'handoff.partial'
  | 'escalation.interrupt'
  | 'escalation.uncertainty';

export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';
export type {
  RequestedRoutingMode,
  RoutingEscalationHook,
} from '@relay-assistant/routing';

export interface ConnectivitySignal {
  id: string;
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  confidence?: number;
  summary: string;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
  emittedAt: string;
  state: SignalState;
}

export interface EmitSignalInput {
  threadId: string;
  source: string;
  audience: SignalAudience;
  messageClass: MessageClass;
  signalClass: SignalClass;
  priority: SignalPriority;
  summary: string;
  confidence?: number;
  details?: string;
  replaces?: string;
  expiresAtStep?: number;
}

export interface SignalQuery {
  threadId: string;
  source?: string;
  messageClass?: MessageClass | MessageClass[];
  signalClass?: SignalClass | SignalClass[];
  state?: SignalState | SignalState[];
  priority?: SignalPriority | SignalPriority[];
  since?: string;
  before?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface SuppressionConfig {
  basis: 'step' | 'time';
  windowMs?: number;
}

export type SelectedAudienceResolver = (signal: ConnectivitySignal) => string[];
export type SignalCallback = (signal: ConnectivitySignal, event: SignalEvent) => void;

export interface ConnectivityLayerConfig {
  suppressionConfig?: SuppressionConfig;
  routingEscalationHook?: RoutingEscalationHook;
}

export interface ConnectivityLayer {
  emit(input: EmitSignalInput): ConnectivitySignal;
  resolve(signalId: string): ConnectivitySignal;
  get(signalId: string): ConnectivitySignal | null;
  query(query: SignalQuery): ConnectivitySignal[];
  advanceStep(threadId: string): void;
  registerSelectedResolver(resolver: SelectedAudienceResolver): void;
  onSignal(callback: SignalCallback): void;
  offSignal(callback: SignalCallback): void;
}

export const SIGNAL_AUDIENCES = [
  'self',
  'coordinator',
  'selected',
  'all',
] as const satisfies readonly SignalAudience[];

export const MESSAGE_CLASSES = [
  'attention',
  'confidence',
  'conflict',
  'handoff',
  'escalation',
] as const satisfies readonly MessageClass[];

export const SIGNAL_CLASSES = [
  'attention.raise',
  'confidence.high',
  'confidence.medium',
  'confidence.low',
  'confidence.blocker',
  'conflict.active',
  'conflict.resolved',
  'handoff.ready',
  'handoff.partial',
  'escalation.interrupt',
  'escalation.uncertainty',
] as const satisfies readonly SignalClass[];

export const SIGNAL_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
] as const satisfies readonly SignalPriority[];

export const SIGNAL_STATES = [
  'emitted',
  'active',
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export const SIGNAL_EVENTS = [
  'emitted',
  'superseded',
  'resolved',
  'expired',
] as const satisfies readonly SignalEvent[];

export const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string> = {
  attention: 'attention.',
  confidence: 'confidence.',
  conflict: 'conflict.',
  handoff: 'handoff.',
  escalation: 'escalation.',
};

export const TERMINAL_STATES = [
  'superseded',
  'expired',
  'resolved',
] as const satisfies readonly SignalState[];

export class ConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectivityError';
  }
}

export class SignalValidationError extends ConnectivityError {
  constructor(message: string) {
    super(message);
    this.name = 'SignalValidationError';
  }
}

export class SignalNotFoundError extends ConnectivityError {
  constructor(signalId: string) {
    super(`Signal not found: ${signalId}`);
    this.name = 'SignalNotFoundError';
  }
}
