import { nanoid } from 'nanoid';
import { ConnectivityError, MESSAGE_CLASSES, MESSAGE_CLASS_TO_SIGNAL_PREFIX, SIGNAL_AUDIENCES, SIGNAL_CLASSES, SIGNAL_PRIORITIES, SignalNotFoundError, SignalValidationError, TERMINAL_STATES, } from './types.js';
const DEFAULT_LIMIT = 50;
const DEFAULT_SUPPRESSION_CONFIG = {
    basis: 'step',
};
const CLASS_CONFIDENCE_RULES = {
    'confidence.high': [0.8, 1.0],
    'confidence.medium': [0.4, 0.79],
    'confidence.low': [0.1, 0.39],
    'confidence.blocker': [0.0, 0.0],
    'conflict.active': [0.0, 1.0],
    'conflict.resolved': [0.0, 1.0],
};
function nowIso() {
    return new Date().toISOString();
}
function generateSignalId() {
    return `sig_${nanoid()}`;
}
function toArray(value) {
    if (value === undefined) {
        return undefined;
    }
    return Array.isArray(value) ? value : [value];
}
function isTerminalState(state) {
    return TERMINAL_STATES.includes(state);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function assertEnum(value, allowed, label) {
    if (!allowed.includes(value)) {
        throw new SignalValidationError(`Invalid ${label}: ${value}`);
    }
}
function validateConfidenceForSignal(input) {
    const confidenceRequired = input.messageClass === 'confidence' || input.messageClass === 'conflict';
    if (confidenceRequired && input.confidence === undefined) {
        throw new SignalValidationError(`confidence is required for ${input.messageClass} signals`);
    }
    if (input.confidence === undefined) {
        return;
    }
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new SignalValidationError('confidence must be between 0.0 and 1.0');
    }
    const rule = CLASS_CONFIDENCE_RULES[input.signalClass];
    if (!rule) {
        return;
    }
    const [min, max] = rule;
    if (input.confidence < min || input.confidence > max) {
        throw new SignalValidationError(`confidence for ${input.signalClass} must be between ${min} and ${max}`);
    }
}
function validateEmitInput(input) {
    if (!isNonEmptyString(input.threadId)) {
        throw new SignalValidationError('threadId must be a non-empty string');
    }
    if (!isNonEmptyString(input.source)) {
        throw new SignalValidationError('source must be a non-empty string');
    }
    if (!isNonEmptyString(input.summary)) {
        throw new SignalValidationError('summary must be a non-empty string');
    }
    assertEnum(input.audience, SIGNAL_AUDIENCES, 'audience');
    assertEnum(input.messageClass, MESSAGE_CLASSES, 'messageClass');
    assertEnum(input.signalClass, SIGNAL_CLASSES, 'signalClass');
    assertEnum(input.priority, SIGNAL_PRIORITIES, 'priority');
    const expectedPrefix = MESSAGE_CLASS_TO_SIGNAL_PREFIX[input.messageClass];
    if (!input.signalClass.startsWith(expectedPrefix)) {
        throw new SignalValidationError(`signalClass ${input.signalClass} does not match messageClass ${input.messageClass}`);
    }
    if (input.expiresAtStep !== undefined &&
        (!Number.isInteger(input.expiresAtStep) || input.expiresAtStep < 0)) {
        throw new SignalValidationError('expiresAtStep must be a non-negative integer');
    }
    validateConfidenceForSignal(input);
}
function getDuplicateKey(input) {
    return `${input.threadId}|${input.source}|${input.signalClass}|${input.audience}`;
}
function fireCallbacks(callbacks, signal, event) {
    for (const callback of callbacks) {
        try {
            callback(signal, event);
        }
        catch (error) {
            console.error('Connectivity signal callback failed', error);
        }
    }
}
function resolveAudience(signal, threadSignals, selectedResolver) {
    switch (signal.audience) {
        case 'self':
            return [signal.source];
        case 'coordinator':
            return ['coordinator'];
        case 'selected':
            return selectedResolver ? selectedResolver(signal) : [];
        case 'all': {
            const recipients = new Set(['coordinator']);
            for (const candidate of threadSignals) {
                recipients.add(candidate.source);
            }
            return [...recipients];
        }
        default:
            return [];
    }
}
function shouldSuppress(input, candidates, suppressionConfig, currentStep, emittedSteps) {
    if (input.priority === 'critical') {
        return null;
    }
    const duplicateKey = getDuplicateKey(input);
    for (const existing of candidates) {
        if (isTerminalState(existing.state)) {
            continue;
        }
        if (getDuplicateKey(existing) !== duplicateKey) {
            continue;
        }
        if (input.priority === 'high' &&
            input.messageClass === 'escalation' &&
            existing.summary !== input.summary) {
            continue;
        }
        if (suppressionConfig.basis === 'step') {
            const emittedStep = emittedSteps.get(existing.id);
            if (emittedStep === currentStep) {
                return existing;
            }
            continue;
        }
        const windowMs = suppressionConfig.windowMs ?? 5_000;
        if (Date.now() - Date.parse(existing.emittedAt) <= windowMs) {
            return existing;
        }
    }
    return null;
}
function ensureMutableSignal(signal) {
    if (isTerminalState(signal.state)) {
        throw new ConnectivityError(`Signal ${signal.id} is already in terminal state ${signal.state}`);
    }
}
function filterByEnum(value, filter) {
    if (!filter || filter.length === 0) {
        return true;
    }
    return filter.includes(value);
}
export function createConnectivityLayer(config = {}) {
    const suppressionConfig = config.suppressionConfig ?? DEFAULT_SUPPRESSION_CONFIG;
    const signalsByThread = new Map();
    const signalsById = new Map();
    const stepsByThread = new Map();
    const emittedSteps = new Map();
    const callbacks = new Set();
    let selectedResolver;
    const getThreadSignals = (threadId) => {
        return signalsByThread.get(threadId) ?? [];
    };
    const getSignal = (signalId) => {
        const signal = signalsById.get(signalId);
        if (!signal) {
            throw new SignalNotFoundError(signalId);
        }
        return signal;
    };
    return {
        emit(input) {
            validateEmitInput(input);
            if (input.replaces) {
                const replaced = getSignal(input.replaces);
                if (replaced.threadId !== input.threadId) {
                    throw new SignalValidationError(`replaces must reference a signal in thread ${input.threadId}`);
                }
            }
            const currentStep = stepsByThread.get(input.threadId) ?? 0;
            const threadSignals = getThreadSignals(input.threadId);
            const suppressed = shouldSuppress(input, threadSignals, suppressionConfig, currentStep, emittedSteps);
            if (suppressed) {
                return suppressed;
            }
            if (input.replaces) {
                const replaced = getSignal(input.replaces);
                ensureMutableSignal(replaced);
                replaced.state = 'superseded';
                fireCallbacks(callbacks, replaced, 'superseded');
            }
            const signal = {
                ...input,
                id: generateSignalId(),
                emittedAt: nowIso(),
                state: 'emitted',
            };
            const nextThreadSignals = [...threadSignals, signal];
            signalsByThread.set(input.threadId, nextThreadSignals);
            signalsById.set(signal.id, signal);
            emittedSteps.set(signal.id, currentStep);
            resolveAudience(signal, nextThreadSignals, selectedResolver);
            if (signal.signalClass === 'escalation.interrupt' ||
                signal.signalClass === 'escalation.uncertainty') {
                try {
                    config.routingEscalationHook?.onEscalation(signal);
                }
                catch (error) {
                    console.error('Connectivity routing escalation hook failed', error);
                }
            }
            fireCallbacks(callbacks, signal, 'emitted');
            // A callback may resolve the signal during the emitted event loop. In that case
            // the state has already moved past emitted and must not be promoted to active.
            if (callbacks.size > 0 && signal.state === 'emitted') {
                signal.state = 'active';
            }
            return signal;
        },
        resolve(signalId) {
            const signal = getSignal(signalId);
            if (signal.state === 'resolved') {
                return signal;
            }
            if (signal.state === 'superseded' || signal.state === 'expired') {
                throw new ConnectivityError(`Cannot resolve signal ${signalId} from terminal state ${signal.state}`);
            }
            signal.state = 'resolved';
            fireCallbacks(callbacks, signal, 'resolved');
            return signal;
        },
        get(signalId) {
            return signalsById.get(signalId) ?? null;
        },
        query(query) {
            const threadSignals = getThreadSignals(query.threadId);
            const messageClasses = toArray(query.messageClass);
            const signalClasses = toArray(query.signalClass);
            const priorities = toArray(query.priority);
            const states = toArray(query.state) ?? ['emitted', 'active'];
            const since = query.since ? Date.parse(query.since) : undefined;
            const before = query.before ? Date.parse(query.before) : undefined;
            const limit = query.limit ?? DEFAULT_LIMIT;
            const order = query.order ?? 'newest';
            const matches = threadSignals.filter((signal) => {
                if (query.source && signal.source !== query.source) {
                    return false;
                }
                if (!filterByEnum(signal.messageClass, messageClasses)) {
                    return false;
                }
                if (!filterByEnum(signal.signalClass, signalClasses)) {
                    return false;
                }
                if (!filterByEnum(signal.priority, priorities)) {
                    return false;
                }
                if (!filterByEnum(signal.state, states)) {
                    return false;
                }
                const emittedAt = Date.parse(signal.emittedAt);
                if (since !== undefined && emittedAt <= since) {
                    return false;
                }
                if (before !== undefined && emittedAt >= before) {
                    return false;
                }
                return true;
            });
            const sorted = [...matches].sort((left, right) => {
                const delta = Date.parse(left.emittedAt) - Date.parse(right.emittedAt);
                return order === 'oldest' ? delta : -delta;
            });
            return sorted.slice(0, limit);
        },
        advanceStep(threadId) {
            const currentStep = (stepsByThread.get(threadId) ?? 0) + 1;
            stepsByThread.set(threadId, currentStep);
            for (const signal of getThreadSignals(threadId)) {
                if (signal.expiresAtStep === undefined ||
                    signal.expiresAtStep > currentStep ||
                    isTerminalState(signal.state)) {
                    continue;
                }
                signal.state = 'expired';
                fireCallbacks(callbacks, signal, 'expired');
            }
        },
        registerSelectedResolver(resolver) {
            selectedResolver = resolver;
        },
        onSignal(callback) {
            callbacks.add(callback);
        },
        offSignal(callback) {
            callbacks.delete(callback);
        },
    };
}
