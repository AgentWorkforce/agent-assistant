import { DEFAULT_MODE_SPECS, MODE_DEPTH, RoutingPolicyError, } from './types.js';
export function createRouter(config = {}) {
    const policy = normalizePolicy(config.policy);
    const defaultModelSpecs = normalizeDefaultModelSpecs(config.defaultModelSpecs);
    const costMap = new Map();
    return {
        decide(context) {
            const decision = resolveDecisionCandidate(context, policy, defaultModelSpecs);
            const modelSpec = buildModelSpec(decision.mode, context, policy, defaultModelSpecs);
            return {
                mode: decision.mode,
                modelSpec,
                reason: decision.reason,
                escalated: decision.escalated,
                overridden: decision.reason === 'hard_constraint',
            };
        },
        recordCost(threadId, cost) {
            if (!threadId) {
                throw new RoutingPolicyError('threadId is required when recording cost');
            }
            if (!Number.isFinite(cost)) {
                throw new RoutingPolicyError('cost must be a finite number');
            }
            costMap.set(threadId, (costMap.get(threadId) ?? 0) + cost);
        },
        getAccumulatedCost(threadId) {
            return costMap.get(threadId) ?? 0;
        },
        resetCost(threadId) {
            costMap.delete(threadId);
        },
        onEscalation(signal) {
            if (!signal.signalClass.startsWith('escalation.')) {
                return undefined;
            }
            const mappedMode = policy.escalationModeMap[signal.signalClass];
            if (!mappedMode) {
                return undefined;
            }
            return clampMode(mappedMode, policy.modeCeiling);
        },
    };
}
function normalizePolicy(policy = {}) {
    const defaultMode = policy.defaultMode ?? 'fast';
    const modeCeiling = policy.modeCeiling ?? 'deep';
    validateMode(defaultMode, 'policy.defaultMode');
    validateMode(modeCeiling, 'policy.modeCeiling');
    for (const [capability, mode] of Object.entries(policy.capabilityModes ?? {})) {
        validateMode(mode, `policy.capabilityModes.${capability}`);
    }
    for (const [signalClass, mode] of Object.entries(policy.escalationModeMap ?? {})) {
        if (mode !== undefined) {
            validateMode(mode, `policy.escalationModeMap.${signalClass}`);
        }
    }
    for (const [mode, spec] of Object.entries(policy.modeModelSpecs ?? {})) {
        validateMode(mode, `policy.modeModelSpecs.${mode}`);
        validateModelSpecOverride(spec, `policy.modeModelSpecs.${mode}`);
    }
    if (policy.costEnvelopeLimit !== undefined &&
        (!Number.isFinite(policy.costEnvelopeLimit) || policy.costEnvelopeLimit < 0)) {
        throw new RoutingPolicyError('policy.costEnvelopeLimit must be a finite number >= 0');
    }
    return {
        defaultMode,
        capabilityModes: { ...(policy.capabilityModes ?? {}) },
        costEnvelopeLimit: policy.costEnvelopeLimit ?? 0,
        modeCeiling,
        escalationModeMap: { ...(policy.escalationModeMap ?? {}) },
        modeModelSpecs: cloneModeModelSpecs(policy.modeModelSpecs),
    };
}
function normalizeDefaultModelSpecs(specs) {
    const normalized = cloneDefaultSpecs(DEFAULT_MODE_SPECS);
    if (!specs) {
        return normalized;
    }
    for (const [mode, override] of Object.entries(specs)) {
        validateMode(mode, `defaultModelSpecs.${mode}`);
        validateModelSpecOverride(override, `defaultModelSpecs.${mode}`);
        normalized[mode] = mergeModelSpec(normalized[mode], override);
    }
    return normalized;
}
function resolveDecisionCandidate(context, policy, defaultModelSpecs) {
    if (context.requestedMode) {
        validateMode(context.requestedMode, 'context.requestedMode');
    }
    let candidate;
    if (context.requestedMode) {
        candidate = {
            mode: context.requestedMode,
            reason: 'caller_requested',
            escalated: false,
        };
    }
    else {
        const capabilityMode = policy.capabilityModes[context.capability];
        if (capabilityMode) {
            candidate = {
                mode: capabilityMode,
                reason: 'capability_override',
                escalated: false,
            };
        }
        else if (policy.costEnvelopeLimit > 0 &&
            (context.accumulatedCost ?? 0) > policy.costEnvelopeLimit) {
            candidate = {
                mode: 'cheap',
                reason: 'cost_envelope_exceeded',
                escalated: false,
            };
        }
        else {
            const escalationMode = pickEscalationMode(context.activeEscalations, policy);
            if (escalationMode) {
                candidate = {
                    mode: escalationMode,
                    reason: 'escalation_signal',
                    escalated: true,
                };
            }
            else {
                const latencyMode = pickLatencyMode(context, policy, defaultModelSpecs);
                if (latencyMode) {
                    candidate = {
                        mode: latencyMode,
                        reason: 'latency_constraint',
                        escalated: false,
                    };
                }
                else {
                    candidate = {
                        mode: policy.defaultMode,
                        reason: 'policy_default',
                        escalated: false,
                    };
                }
            }
        }
    }
    if (MODE_DEPTH[candidate.mode] > MODE_DEPTH[policy.modeCeiling]) {
        return {
            mode: policy.modeCeiling,
            reason: 'hard_constraint',
            escalated: candidate.escalated || MODE_DEPTH[candidate.mode] > MODE_DEPTH[policy.modeCeiling],
        };
    }
    return candidate;
}
function pickEscalationMode(escalations, policy) {
    if (!escalations?.length) {
        return null;
    }
    let selected = null;
    for (const escalation of escalations) {
        const mappedMode = policy.escalationModeMap[escalation.signalClass];
        if (!mappedMode) {
            continue;
        }
        const priority = getPriorityDepth(escalation.priority);
        if (!selected) {
            selected = { mode: mappedMode, priority };
            continue;
        }
        const isHigherPriority = priority > selected.priority;
        const samePriorityButDeeper = priority === selected.priority && MODE_DEPTH[mappedMode] > MODE_DEPTH[selected.mode];
        if (isHigherPriority || samePriorityButDeeper) {
            selected = { mode: mappedMode, priority };
        }
    }
    return selected?.mode ?? null;
}
function pickLatencyMode(context, policy, defaultModelSpecs) {
    const requestedMaxLatencyMs = context.requestedMaxLatencyMs ?? 0;
    if (requestedMaxLatencyMs <= 0) {
        return null;
    }
    const deepSpec = getBaseModelSpec('deep', policy, defaultModelSpecs);
    if (canMeetLatency(deepSpec.maxLatencyMs, requestedMaxLatencyMs)) {
        return null;
    }
    const fastSpec = getBaseModelSpec('fast', policy, defaultModelSpecs);
    if (canMeetLatency(fastSpec.maxLatencyMs, requestedMaxLatencyMs)) {
        return 'fast';
    }
    return 'cheap';
}
function buildModelSpec(mode, context, policy, defaultModelSpecs) {
    let spec = getBaseModelSpec(mode, policy, defaultModelSpecs);
    if (context.requiresToolUse) {
        spec.requiresToolUse = true;
    }
    if (context.requiresStreaming) {
        spec.requiresStreaming = true;
    }
    if (context.minContextTokens !== undefined) {
        spec.minContextTokens = Math.max(spec.minContextTokens, context.minContextTokens);
    }
    if (context.requestedMaxLatencyMs !== undefined) {
        spec.maxLatencyMs = context.requestedMaxLatencyMs;
    }
    return spec;
}
function getBaseModelSpec(mode, policy, defaultModelSpecs) {
    return mergeModelSpec(defaultModelSpecs[mode], policy.modeModelSpecs[mode]);
}
function mergeModelSpec(base, override) {
    if (!override) {
        return {
            ...base,
            hints: { ...base.hints },
        };
    }
    return {
        ...base,
        ...override,
        mode: base.mode,
        hints: {
            ...base.hints,
            ...(override.hints ?? {}),
        },
    };
}
function cloneDefaultSpecs(source) {
    return {
        cheap: mergeModelSpec(source.cheap, undefined),
        fast: mergeModelSpec(source.fast, undefined),
        deep: mergeModelSpec(source.deep, undefined),
    };
}
function cloneModeModelSpecs(specs) {
    if (!specs) {
        return {};
    }
    const clone = {};
    for (const [mode, spec] of Object.entries(specs)) {
        validateMode(mode, `policy.modeModelSpecs.${mode}`);
        if (!spec) {
            clone[mode] = spec;
            continue;
        }
        clone[mode] = spec.hints
            ? { ...spec, hints: { ...spec.hints } }
            : { ...spec };
    }
    return clone;
}
function clampMode(mode, ceiling) {
    return MODE_DEPTH[mode] > MODE_DEPTH[ceiling] ? ceiling : mode;
}
function canMeetLatency(specLatency, requestedLatency) {
    return specLatency > 0 && specLatency <= requestedLatency;
}
function validateMode(mode, field) {
    if (mode !== 'cheap' && mode !== 'fast' && mode !== 'deep') {
        throw new RoutingPolicyError(`${field} must be one of cheap, fast, or deep`);
    }
}
function validateModelSpecOverride(spec, field) {
    if (!spec) {
        return;
    }
    if (spec.mode !== undefined && spec.mode !== 'cheap' && spec.mode !== 'fast' && spec.mode !== 'deep') {
        throw new RoutingPolicyError(`${field}.mode must be one of cheap, fast, or deep`);
    }
    if (spec.minContextTokens !== undefined && (!Number.isFinite(spec.minContextTokens) || spec.minContextTokens < 0)) {
        throw new RoutingPolicyError(`${field}.minContextTokens must be a finite number >= 0`);
    }
    if (spec.maxLatencyMs !== undefined && (!Number.isFinite(spec.maxLatencyMs) || spec.maxLatencyMs < 0)) {
        throw new RoutingPolicyError(`${field}.maxLatencyMs must be a finite number >= 0`);
    }
}
function normalizePriority(priority) {
    if (priority === 'low' || priority === 'normal' || priority === 'high' || priority === 'critical') {
        return priority;
    }
    return 'normal';
}
function getPriorityDepth(priority) {
    switch (normalizePriority(priority)) {
        case 'low':
            return 0;
        case 'normal':
            return 1;
        case 'high':
            return 2;
        case 'critical':
            return 3;
    }
}
