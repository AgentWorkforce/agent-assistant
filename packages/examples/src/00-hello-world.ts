/**
 * 00-hello-world.ts
 * Minimum viable assistant using @agent-assistant/sdk.
 * One install. One import. Zero additional packages.
 */
import {
  createAssistant,
  createTraitsProvider,
  createSessionStore,
  InMemorySessionStoreAdapter,
  createSurfaceRegistry,
} from '@agent-assistant/sdk';
import type {
  InboundMessage,
  CapabilityContext,
  SurfaceConnection,
  SurfaceCapabilities,
} from '@agent-assistant/sdk';

const traits = createTraitsProvider(
  {
    voice: 'concise',
    formality: 'professional',
    proactivity: 'medium',
    riskPosture: 'moderate',
    domain: 'engineering',
  },
  { preferMarkdown: true },
);

const sessionStore = createSessionStore({
  adapter: new InMemorySessionStoreAdapter(),
});

const surfaceRegistry = createSurfaceRegistry();

const capabilities: SurfaceCapabilities = {
  markdown: true,
  richBlocks: false,
  attachments: false,
  streaming: false,
  maxResponseLength: 2000,
};

const connection: SurfaceConnection = {
  id: 'hello-world-surface',
  type: 'slack' as const,
  state: 'registered',
  capabilities,
  adapter: surfaceRegistry as any, // replace with real adapter in production
};

surfaceRegistry.register(connection);

export async function assembleHelloWorldAssistant() {
  const runtime = createAssistant(
    {
      id: 'hello-world-assistant',
      name: 'Hello World',
      traits,
      capabilities: {
        reply: async (message: InboundMessage, context: CapabilityContext) => {
          await context.runtime.emit({
            surfaceId: message.surfaceId,
            text: `Hello from ${context.runtime.definition.name}`,
          });
        },
      },
    },
    { inbound: surfaceRegistry, outbound: surfaceRegistry },
  );

  runtime.register('sessions', sessionStore);
  await runtime.start();
  return runtime;
}
