import type { RoutingEscalationHook } from '@relay-assistant/routing';
export type SignalAudience = 'self' | 'coordinator' | 'selected' | 'all';
export type MessageClass = 'attention' | 'confidence' | 'conflict' | 'handoff' | 'escalation';
export type SignalClass = 'attention.raise' | 'confidence.high' | 'confidence.medium' | 'confidence.low' | 'confidence.blocker' | 'conflict.active' | 'conflict.resolved' | 'handoff.ready' | 'handoff.partial' | 'escalation.interrupt' | 'escalation.uncertainty';
export type SignalPriority = 'low' | 'normal' | 'high' | 'critical';
export type SignalState = 'emitted' | 'active' | 'superseded' | 'expired' | 'resolved';
export type SignalEvent = 'emitted' | 'superseded' | 'resolved' | 'expired';
export type { RequestedRoutingMode, RoutingEscalationHook, } from '@relay-assistant/routing';
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
export declare const SIGNAL_AUDIENCES: readonly ["self", "coordinator", "selected", "all"];
export declare const MESSAGE_CLASSES: readonly ["attention", "confidence", "conflict", "handoff", "escalation"];
export declare const SIGNAL_CLASSES: readonly ["attention.raise", "confidence.high", "confidence.medium", "confidence.low", "confidence.blocker", "conflict.active", "conflict.resolved", "handoff.ready", "handoff.partial", "escalation.interrupt", "escalation.uncertainty"];
export declare const SIGNAL_PRIORITIES: readonly ["low", "normal", "high", "critical"];
export declare const SIGNAL_STATES: readonly ["emitted", "active", "superseded", "expired", "resolved"];
export declare const SIGNAL_EVENTS: readonly ["emitted", "superseded", "resolved", "expired"];
export declare const MESSAGE_CLASS_TO_SIGNAL_PREFIX: Record<MessageClass, string>;
export declare const TERMINAL_STATES: readonly ["superseded", "expired", "resolved"];
export declare class ConnectivityError extends Error {
    constructor(message: string);
}
export declare class SignalValidationError extends ConnectivityError {
    constructor(message: string);
}
export declare class SignalNotFoundError extends ConnectivityError {
    constructor(signalId: string);
}
