const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_HANDLERS = 10;
const STOP_DRAIN_TIMEOUT_MS = 30_000;
export class AssistantDefinitionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssistantDefinitionError';
    }
}
export class OutboundEventError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OutboundEventError';
    }
}
function freezeDefinition(definition) {
    const frozenCapabilities = Object.freeze({ ...definition.capabilities });
    const frozenHooks = definition.hooks ? Object.freeze({ ...definition.hooks }) : undefined;
    const frozenConstraints = definition.constraints
        ? Object.freeze({ ...definition.constraints })
        : undefined;
    return Object.freeze({
        ...definition,
        capabilities: frozenCapabilities,
        hooks: frozenHooks,
        constraints: frozenConstraints,
    });
}
function createContextLogger(context) {
    const baseFields = {
        messageId: context.messageId,
        capability: context.capability,
        surfaceId: context.surfaceId,
    };
    return {
        info(message, fields = {}) {
            console.info(message, { ...baseFields, ...fields });
        },
        warn(message, fields = {}) {
            console.warn(message, { ...baseFields, ...fields });
        },
        error(message, fields = {}) {
            console.error(message, { ...baseFields, ...fields });
        },
    };
}
function createDeferred() {
    let resolve = () => { };
    const promise = new Promise((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}
function createTimeoutError(message, timeoutMs) {
    return new Error(`Capability '${message.capability}' timed out after ${timeoutMs}ms for message '${message.id}'`);
}
function validateDefinition(definition) {
    if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
        throw new AssistantDefinitionError("Assistant definition requires a non-empty 'id'");
    }
    if (typeof definition.name !== 'string' || definition.name.trim().length === 0) {
        throw new AssistantDefinitionError("Assistant definition requires a non-empty 'name'");
    }
    if (definition.capabilities === null ||
        typeof definition.capabilities !== 'object' ||
        Array.isArray(definition.capabilities)) {
        throw new AssistantDefinitionError("Assistant definition requires a capabilities object");
    }
    const entries = Object.entries(definition.capabilities);
    if (entries.length === 0) {
        throw new AssistantDefinitionError('Assistant definition requires at least one capability');
    }
    for (const [capability, handler] of entries) {
        if (typeof handler !== 'function') {
            throw new AssistantDefinitionError(`Capability '${capability}' must be a function handler`);
        }
    }
}
async function withTimeout(handler, message, context, timeoutMs) {
    let timeoutHandle;
    try {
        await Promise.race([
            Promise.resolve(handler(message, context)),
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(createTimeoutError(message, timeoutMs));
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
async function resolveAttachedSurfaces(sessionSubsystem, sessionId) {
    const session = 'getSession' in sessionSubsystem
        ? await sessionSubsystem.getSession(sessionId)
        : await sessionSubsystem.get(sessionId);
    if (!session) {
        throw new Error(`Session '${sessionId}' could not be resolved for fanout`);
    }
    return Array.isArray(session.attachedSurfaces) ? [...session.attachedSurfaces] : [];
}
export function createAssistant(definition, adapters) {
    validateDefinition(definition);
    const frozenDefinition = freezeDefinition(definition);
    const capabilityMap = new Map(Object.entries(frozenDefinition.capabilities));
    const subsystems = new Map();
    const pendingDispatches = [];
    let lifecycleState = 'created';
    let inFlightCount = 0;
    let startedAt = null;
    let drainWaiter = null;
    const constraints = {
        handlerTimeoutMs: frozenDefinition.constraints?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
        maxConcurrentHandlers: frozenDefinition.constraints?.maxConcurrentHandlers ?? DEFAULT_MAX_CONCURRENT_HANDLERS,
    };
    const runtime = {
        definition: frozenDefinition,
        async emit(event) {
            if (!event.surfaceId && !event.sessionId) {
                throw new OutboundEventError("Outbound event requires either 'surfaceId' or 'sessionId'");
            }
            if (event.surfaceId) {
                await adapters.outbound.send(event);
                return;
            }
            const sessionSubsystem = runtime.get('sessions');
            const surfaceIds = await resolveAttachedSurfaces(sessionSubsystem, event.sessionId);
            if (adapters.outbound.fanout) {
                await adapters.outbound.fanout(event, surfaceIds);
                return;
            }
            for (const surfaceId of surfaceIds) {
                await adapters.outbound.send({ ...event, surfaceId });
            }
        },
        async dispatch(message) {
            if (lifecycleState !== 'started') {
                throw new Error('Assistant runtime must be started before dispatching messages');
            }
            return new Promise((resolve, reject) => {
                pendingDispatches.push({ message, resolve, reject });
                runNext();
            });
        },
        register(name, subsystem) {
            subsystems.set(name, subsystem);
            return runtime;
        },
        get(name) {
            if (!subsystems.has(name)) {
                throw new Error(`Subsystem '${name}' is not registered`);
            }
            return subsystems.get(name);
        },
        status() {
            return {
                ready: lifecycleState === 'started',
                startedAt,
                registeredSubsystems: [...subsystems.keys()],
                registeredCapabilities: [...capabilityMap.keys()],
                inFlightHandlers: inFlightCount,
            };
        },
        async start() {
            if (lifecycleState === 'started') {
                return;
            }
            if (lifecycleState === 'stopped') {
                throw new Error('Assistant runtime cannot be restarted after stop()');
            }
            lifecycleState = 'started';
            startedAt = new Date().toISOString();
            adapters.inbound.onMessage(inboundHandler);
            await frozenDefinition.hooks?.onStart?.(runtime);
        },
        async stop() {
            if (lifecycleState === 'stopped') {
                return;
            }
            const wasStarted = lifecycleState === 'started';
            lifecycleState = 'stopped';
            if (wasStarted) {
                adapters.inbound.offMessage(inboundHandler);
                await waitForDrain();
                await frozenDefinition.hooks?.onStop?.(runtime);
            }
        },
    };
    const inboundHandler = (message) => {
        void runtime.dispatch(message);
    };
    function maybeResolveDrainWaiter() {
        if (inFlightCount === 0 && drainWaiter) {
            drainWaiter.resolve();
            drainWaiter = null;
        }
    }
    async function waitForDrain() {
        if (inFlightCount === 0) {
            return;
        }
        drainWaiter ??= createDeferred();
        await Promise.race([
            drainWaiter.promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Timed out waiting ${STOP_DRAIN_TIMEOUT_MS}ms for in-flight handlers to drain`));
                }, STOP_DRAIN_TIMEOUT_MS);
            }),
        ]);
    }
    function runNext() {
        while (lifecycleState === 'started' &&
            inFlightCount < constraints.maxConcurrentHandlers &&
            pendingDispatches.length > 0) {
            const nextDispatch = pendingDispatches.shift();
            if (!nextDispatch) {
                return;
            }
            inFlightCount += 1;
            void executeDispatch(nextDispatch);
        }
    }
    async function executeDispatch(dispatchJob) {
        const { message, resolve, reject } = dispatchJob;
        try {
            const shouldProcess = await frozenDefinition.hooks?.onMessage?.(message);
            if (shouldProcess === false) {
                resolve();
                return;
            }
            const handler = capabilityMap.get(message.capability);
            if (!handler) {
                frozenDefinition.hooks?.onError?.(new Error(`No capability registered for '${message.capability}'`), message);
                resolve();
                return;
            }
            const context = {
                runtime,
                log: createContextLogger({
                    messageId: message.id,
                    capability: message.capability,
                    surfaceId: message.surfaceId,
                }),
            };
            try {
                await withTimeout(handler, message, context, constraints.handlerTimeoutMs);
            }
            catch (error) {
                frozenDefinition.hooks?.onError?.(error instanceof Error ? error : new Error(String(error)), message);
            }
            resolve();
        }
        catch (error) {
            const wrappedError = error instanceof Error ? error : new Error(String(error));
            frozenDefinition.hooks?.onError?.(wrappedError, message);
            reject(wrappedError);
        }
        finally {
            inFlightCount -= 1;
            maybeResolveDrainWaiter();
            runNext();
        }
    }
    return runtime;
}
