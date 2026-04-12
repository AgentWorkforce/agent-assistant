import { describe, expect, it, vi } from 'vitest';

import { createTraitsProvider } from '../../traits/src/index.js';
import type { TraitsProvider } from '../../traits/src/types.js';
import { createAssistant } from './index.js';
import type {
  AssistantDefinition,
  InboundMessage,
  OutboundEvent,
  RelayInboundAdapter,
  RelayOutboundAdapter,
} from './types.js';

function createStubAdapters() {
  const handlers = new Set<(message: InboundMessage) => void>();
  const sent: OutboundEvent[] = [];

  const inbound: RelayInboundAdapter = {
    onMessage(handler) {
      handlers.add(handler);
    },
    offMessage(handler) {
      handlers.delete(handler);
    },
  };

  const outbound: RelayOutboundAdapter = {
    async send(event) {
      sent.push(event);
    },
  };

  return { inbound, outbound, sent, handlers };
}

function createMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    surfaceId: 'surface-a',
    sessionId: 'session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    text: 'hello',
    raw: { source: 'test' },
    receivedAt: '2026-04-12T00:00:00.000Z',
    capability: 'reply',
    ...overrides,
  };
}

function createBaseDefinition(overrides: Partial<AssistantDefinition> = {}): AssistantDefinition {
  return {
    id: 'traits-test-assistant',
    name: 'Traits Test Assistant',
    capabilities: {
      reply: async () => undefined,
    },
    ...overrides,
  };
}

function createBaseProvider(): TraitsProvider {
  return createTraitsProvider(
    {
      voice: 'concise',
      formality: 'professional',
      proactivity: 'medium',
      riskPosture: 'moderate',
    },
    {
      preferredResponseLength: 800,
      preferMarkdown: true,
      preferRichBlocks: false,
    },
  );
}

describe('core-traits integration (WF-5)', () => {
  // Test 1: Definition with traits creates a valid runtime
  it('definition with traits creates a valid runtime and exposes traits on runtime.definition', () => {
    const adapters = createStubAdapters();
    const provider = createBaseProvider();

    const runtime = createAssistant(
      createBaseDefinition({ traits: provider }),
      adapters,
    );

    expect(runtime.definition.traits).toBeDefined();
    expect(runtime.definition.traits?.traits.voice).toBe('concise');
    expect(runtime.definition.traits?.traits.formality).toBe('professional');
    expect(runtime.definition.traits?.traits.proactivity).toBe('medium');
    expect(runtime.definition.traits?.traits.riskPosture).toBe('moderate');
    expect(runtime.definition.traits?.surfaceFormatting?.preferMarkdown).toBe(true);
    expect(runtime.definition.traits?.surfaceFormatting?.preferRichBlocks).toBe(false);
    expect(runtime.definition.traits?.surfaceFormatting?.preferredResponseLength).toBe(800);
  });

  // Test 2: Definition without traits creates a valid runtime — no regression
  it('definition without traits creates a valid runtime with traits as undefined', () => {
    const adapters = createStubAdapters();

    const runtime = createAssistant(
      createBaseDefinition(),
      adapters,
    );

    expect(runtime.definition.traits).toBeUndefined();
    expect(runtime.definition.id).toBe('traits-test-assistant');
    expect(runtime.status().registeredCapabilities).toEqual(['reply']);
  });

  // Test 3: Traits are frozen on the runtime definition
  it('traits are frozen on the runtime definition — mutating voice throws TypeError', () => {
    const adapters = createStubAdapters();
    const provider = createBaseProvider();

    const runtime = createAssistant(
      createBaseDefinition({ traits: provider }),
      adapters,
    );

    expect(Object.isFrozen(runtime.definition.traits)).toBe(true);
    expect(Object.isFrozen(runtime.definition.traits?.traits)).toBe(true);

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (runtime.definition.traits!.traits as { voice: string }).voice = 'formal';
    }).toThrow(TypeError);
  });

  // Test 4: Traits are accessible in capability handlers
  it('traits are accessible inside capability handlers via context.runtime.definition.traits', async () => {
    const adapters = createStubAdapters();
    const provider = createBaseProvider();
    const capturedVoice = vi.fn();

    const runtime = createAssistant(
      createBaseDefinition({
        traits: provider,
        capabilities: {
          reply: async (_message, context) => {
            const voice = context.runtime.definition.traits?.traits.voice;
            capturedVoice(voice);
          },
        },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.dispatch(createMessage());
    await runtime.stop();

    expect(capturedVoice).toHaveBeenCalledTimes(1);
    expect(capturedVoice).toHaveBeenCalledWith('concise');
  });

  // Test 5: Traits are accessible in lifecycle hooks
  it('traits are accessible in the onStart lifecycle hook via runtime.definition.traits', async () => {
    const adapters = createStubAdapters();
    const provider = createBaseProvider();
    const capturedTraits = vi.fn();

    const runtime = createAssistant(
      createBaseDefinition({
        traits: provider,
        hooks: {
          onStart(rt) {
            capturedTraits(rt.definition.traits);
          },
        },
      }),
      adapters,
    );

    await runtime.start();
    await runtime.stop();

    expect(capturedTraits).toHaveBeenCalledTimes(1);
    const receivedTraits: TraitsProvider = capturedTraits.mock.calls[0]?.[0];
    expect(receivedTraits).toBeDefined();
    expect(receivedTraits.traits.voice).toBe('concise');
    expect(receivedTraits.traits.formality).toBe('professional');
  });

  // Test 6: Raw (non-frozen) traits object is frozen by core
  it('raw plain-object traits passed as definition.traits are frozen by core during assembly', () => {
    const adapters = createStubAdapters();

    // Construct a plain object that satisfies TraitsProvider's shape without using createTraitsProvider
    const rawProvider: TraitsProvider = {
      traits: {
        voice: 'conversational',
        formality: 'casual',
        proactivity: 'low',
        riskPosture: 'cautious',
      },
      surfaceFormatting: {
        preferMarkdown: false,
      },
    };

    expect(Object.isFrozen(rawProvider)).toBe(false);

    const runtime = createAssistant(
      createBaseDefinition({ traits: rawProvider }),
      adapters,
    );

    // Core must freeze the provider object during definition freeze
    expect(Object.isFrozen(runtime.definition.traits)).toBe(true);
    expect(runtime.definition.traits?.traits.voice).toBe('conversational');
  });

  // Backward compatibility: all core fields remain independently accessible
  it('traits field coexists cleanly with all other AssistantDefinition fields', () => {
    const adapters = createStubAdapters();
    const provider = createBaseProvider();
    const onStartHook = vi.fn();

    const runtime = createAssistant(
      {
        id: 'full-definition-assistant',
        name: 'Full Definition Assistant',
        description: 'Tests complete definition composition with traits',
        traits: provider,
        capabilities: {
          reply: async () => undefined,
          summarize: async () => undefined,
        },
        hooks: {
          onStart: onStartHook,
        },
        constraints: {
          handlerTimeoutMs: 5000,
          maxConcurrentHandlers: 3,
        },
      },
      adapters,
    );

    expect(runtime.definition.id).toBe('full-definition-assistant');
    expect(runtime.definition.name).toBe('Full Definition Assistant');
    expect(runtime.definition.description).toBe('Tests complete definition composition with traits');
    expect(runtime.definition.traits?.traits.voice).toBe('concise');
    expect(runtime.definition.constraints?.handlerTimeoutMs).toBe(5000);
    expect(runtime.status().registeredCapabilities).toEqual(['reply', 'summarize']);
  });

  // Persona boundary: traits are data, not behavior — core never branches on trait values
  it('two assistants with different traits dispatch identically — core does not branch on trait values', async () => {
    const conciseHandler = vi.fn();
    const verboseHandler = vi.fn();

    const conciseAdapters = createStubAdapters();
    const verboseAdapters = createStubAdapters();

    const conciseRuntime = createAssistant(
      createBaseDefinition({
        traits: createTraitsProvider({ voice: 'concise', formality: 'professional', proactivity: 'low', riskPosture: 'cautious' }),
        capabilities: { reply: conciseHandler },
      }),
      conciseAdapters,
    );

    const verboseRuntime = createAssistant(
      createBaseDefinition({
        id: 'verbose-assistant',
        traits: createTraitsProvider({ voice: 'conversational', formality: 'casual', proactivity: 'high', riskPosture: 'assertive' }),
        capabilities: { reply: verboseHandler },
      }),
      verboseAdapters,
    );

    await conciseRuntime.start();
    await verboseRuntime.start();

    await conciseRuntime.dispatch(createMessage());
    await verboseRuntime.dispatch(createMessage());

    await conciseRuntime.stop();
    await verboseRuntime.stop();

    // Both handlers are called exactly once — core dispatches identically regardless of trait values
    expect(conciseHandler).toHaveBeenCalledTimes(1);
    expect(verboseHandler).toHaveBeenCalledTimes(1);
  });

  // Surface formatting traits flow through without alteration
  it('surface formatting traits are accessible and unmodified on the runtime definition', () => {
    const adapters = createStubAdapters();
    const provider = createTraitsProvider(
      {
        voice: 'technical',
        formality: 'academic',
        proactivity: 'high',
        riskPosture: 'moderate',
        domain: 'software-engineering',
        vocabulary: ['refactor', 'pipeline', 'abstraction'],
      },
      {
        preferredResponseLength: 1200,
        preferRichBlocks: true,
        preferMarkdown: true,
      },
    );

    const runtime = createAssistant(
      createBaseDefinition({ traits: provider }),
      adapters,
    );

    const sf = runtime.definition.traits?.surfaceFormatting;
    expect(sf?.preferredResponseLength).toBe(1200);
    expect(sf?.preferRichBlocks).toBe(true);
    expect(sf?.preferMarkdown).toBe(true);

    const tr = runtime.definition.traits?.traits;
    expect(tr?.domain).toBe('software-engineering');
    expect(tr?.vocabulary).toEqual(['refactor', 'pipeline', 'abstraction']);
    expect(Object.isFrozen(tr?.vocabulary)).toBe(true);
  });
});
