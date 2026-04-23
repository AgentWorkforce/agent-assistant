import type {
  AssistantDefinition,
  AssistantRuntime,
  CapabilityContext,
  CapabilityHandler,
  ContextLogger,
  InboundMessage,
  OutboundEvent,
  RelayInboundAdapter,
  RelayOutboundAdapter,
} from './types.js';

const DEFAULT_HANDLER_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_CONCURRENT_HANDLERS = 10;
const DRAIN_MARGIN_MS = 5_000;

type RuntimeLifecycleState = 'created' | 'started' | 'stopped';

type QueuedDispatch = {
  message: InboundMessage;
  resolve: () => void;
  reject: (error: Error) => void;
};

type SessionRecord = {
  attachedSurfaces?: string[];
};

type SessionSubsystem =
  | {
      get(sessionId: string): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>;
    }
  | {
      getSession(
        sessionId: string,
      ): SessionRecord | null | undefined | Promise<SessionRecord | null | undefined>;
    };

export class AssistantDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantDefinitionError';
  }
}

export class OutboundEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundEventError';
  }
}

function freezeDefinition(definition: AssistantDefinition): Readonly<AssistantDefinition> {
  const frozenCapabilities = Object.freeze({ ...definition.capabilities });
  const frozenHooks = definition.hooks ? Object.freeze({ ...definition.hooks }) : undefined;
  const frozenConstraints = definition.constraints
    ? Object.freeze({ ...definition.constraints })
    : undefined;
  const frozenTraits = definition.traits ? Object.freeze(definition.traits) : undefined;

  return Object.freeze({
    ...definition,
    capabilities: frozenCapabilities,
    hooks: frozenHooks,
    constraints: frozenConstraints,
    traits: frozenTraits,
  });
}

function createContextLogger(context: {
  messageId: string;
  capability: string;
  surfaceId: string;
}): ContextLogger {
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

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function createTimeoutError(message: InboundMessage, timeoutMs: number): Error {
  return new Error(
    `Capability '${message.capability}' timed out after ${timeoutMs}ms for message '${message.id}'`,
  );
}

function validateDefinition(definition: AssistantDefinition): void {
  if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    throw new AssistantDefinitionError("Assistant definition requires a non-empty 'id'");
  }

  if (typeof definition.name !== 'string' || definition.name.trim().length === 0) {
    throw new AssistantDefinitionError("Assistant definition requires a non-empty 'name'");
  }

  if (
    definition.capabilities === null ||
    typeof definition.capabilities !== 'object' ||
    Array.isArray(definition.capabilities)
  ) {
    throw new AssistantDefinitionError("Assistant definition requires a capabilities object");
  }

  const entries = Object.entries(definition.capabilities);
  if (entries.length === 0) {
    throw new AssistantDefinitionError('Assistant definition requires at least one capability');
  }

  for (const [capability, handler] of entries) {
    if (typeof handler !== 'function') {
      throw new AssistantDefinitionError(
        `Capability '${capability}' must be a function handler`,
      );
    }
  }
}

async function withTimeout(
  handler: CapabilityHandler,
  message: InboundMessage,
  context: CapabilityContext,
  timeoutMs: number,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      Promise.resolve(handler(message, context)),
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createTimeoutError(message, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveAttachedSurfaces(
  sessionSubsystem: SessionSubsystem,
  sessionId: string,
): Promise<string[]> {
  const session =
    'getSession' in sessionSubsystem
      ? await sessionSubsystem.getSession(sessionId)
      : await sessionSubsystem.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' could not be resolved for fanout`);
  }

  return Array.isArray(session.attachedSurfaces) ? [...session.attachedSurfaces] : [];
}

export function createAssistant(
  definition: AssistantDefinition,
  adapters: {
    inbound: RelayInboundAdapter;
    outbound: RelayOutboundAdapter;
  },
): AssistantRuntime {
  validateDefinition(definition);

  const frozenDefinition = freezeDefinition(definition);
  const capabilityMap = new Map<string, CapabilityHandler>(
    Object.entries(frozenDefinition.capabilities),
  );
  const subsystems = new Map<string, unknown>();
  const pendingDispatches: QueuedDispatch[] = [];

  let lifecycleState: RuntimeLifecycleState = 'created';
  let inFlightCount = 0;
  let startedAt: string | null = null;
  let drainWaiter: ReturnType<typeof createDeferred> | null = null;

  const constraints = {
    handlerTimeoutMs:
      frozenDefinition.constraints?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
    maxConcurrentHandlers:
      frozenDefinition.constraints?.maxConcurrentHandlers ?? DEFAULT_MAX_CONCURRENT_HANDLERS,
  };

  const runtime: AssistantRuntime = {
    definition: frozenDefinition,

    async emit(event) {
      if (!event.surfaceId && !event.sessionId) {
        throw new OutboundEventError(
          "Outbound event requires either 'surfaceId' or 'sessionId'",
        );
      }

      if (event.surfaceId) {
        await adapters.outbound.send(event);
        return;
      }

      const sessionSubsystem = runtime.get<SessionSubsystem>('sessions');
      const surfaceIds = await resolveAttachedSurfaces(sessionSubsystem, event.sessionId as string);

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

      return new Promise<void>((resolve, reject) => {
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

      return subsystems.get(name) as never;
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

  const inboundHandler = (message: InboundMessage): void => {
    void runtime.dispatch(message);
  };

  function maybeResolveDrainWaiter(): void {
    if (inFlightCount === 0 && drainWaiter) {
      drainWaiter.resolve();
      drainWaiter = null;
    }
  }

  async function waitForDrain(): Promise<void> {
    if (inFlightCount === 0) {
      return;
    }

    drainWaiter ??= createDeferred();
    const drainTimeoutMs = constraints.handlerTimeoutMs + DRAIN_MARGIN_MS;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        drainWaiter.promise,
        new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `Timed out waiting ${drainTimeoutMs}ms for in-flight handlers to drain`,
              ),
            );
          }, drainTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  function runNext(): void {
    while (
      lifecycleState === 'started' &&
      inFlightCount < constraints.maxConcurrentHandlers &&
      pendingDispatches.length > 0
    ) {
      const nextDispatch = pendingDispatches.shift();
      if (!nextDispatch) {
        return;
      }

      inFlightCount += 1;
      void executeDispatch(nextDispatch);
    }
  }

  async function executeDispatch(dispatchJob: QueuedDispatch): Promise<void> {
    const { message, resolve, reject } = dispatchJob;

    try {
      const shouldProcess = await frozenDefinition.hooks?.onMessage?.(message);
      if (shouldProcess === false) {
        resolve();
        return;
      }

      const handler = capabilityMap.get(message.capability);
      if (!handler) {
        frozenDefinition.hooks?.onError?.(
          new Error(`No capability registered for '${message.capability}'`),
          message,
        );
        resolve();
        return;
      }

      const context: CapabilityContext = {
        runtime,
        log: createContextLogger({
          messageId: message.id,
          capability: message.capability,
          surfaceId: message.surfaceId,
        }),
      };

      try {
        await withTimeout(handler, message, context, constraints.handlerTimeoutMs);
      } catch (error) {
        frozenDefinition.hooks?.onError?.(
          error instanceof Error ? error : new Error(String(error)),
          message,
        );
      }

      resolve();
    } catch (error) {
      const wrappedError = error instanceof Error ? error : new Error(String(error));
      frozenDefinition.hooks?.onError?.(wrappedError, message);
      reject(wrappedError);
    } finally {
      inFlightCount -= 1;
      maybeResolveDrainWaiter();
      runNext();
    }
  }

  return runtime;
}
