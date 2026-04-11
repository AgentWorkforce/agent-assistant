export const SIGNAL_AUDIENCES = [
    'self',
    'coordinator',
    'selected',
    'all',
];
export const MESSAGE_CLASSES = [
    'attention',
    'confidence',
    'conflict',
    'handoff',
    'escalation',
];
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
];
export const SIGNAL_PRIORITIES = [
    'low',
    'normal',
    'high',
    'critical',
];
export const SIGNAL_STATES = [
    'emitted',
    'active',
    'superseded',
    'expired',
    'resolved',
];
export const SIGNAL_EVENTS = [
    'emitted',
    'superseded',
    'resolved',
    'expired',
];
export const MESSAGE_CLASS_TO_SIGNAL_PREFIX = {
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
];
export class ConnectivityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConnectivityError';
    }
}
export class SignalValidationError extends ConnectivityError {
    constructor(message) {
        super(message);
        this.name = 'SignalValidationError';
    }
}
export class SignalNotFoundError extends ConnectivityError {
    constructor(signalId) {
        super(`Signal not found: ${signalId}`);
        this.name = 'SignalNotFoundError';
    }
}
