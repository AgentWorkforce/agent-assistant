/**
 * 02 — Traits-Aware Assistant
 *
 * Extends the minimal assembly with a TraitsProvider from
 * @relay-assistant/traits. Core stores and freezes the provider — it never
 * interprets trait values. Capability handlers read traits as data and make
 * their own formatting decisions.
 *
 * Key pattern:
 *   Traits are declarative data attached at definition time.
 *   Interpretation happens in capability code, not in core.
 */

import { createAssistant } from '@relay-assistant/core';
import type {
  InboundMessage,
  RelayInboundAdapter,
  RelayOutboundAdapter,
  OutboundEvent,
} from '@relay-assistant/core';
import { createTraitsProvider } from '@relay-assistant/traits';

// --- Adapters (same thin wrappers as 01) ---------------------------------

function createInMemoryInbound(): RelayInboundAdapter & {
  push(message: InboundMessage): void;
} {
  let handler: ((message: InboundMessage) => void) | null = null;
  return {
    onMessage(h) { handler = h; },
    offMessage() { handler = null; },
    push(message) { handler?.(message); },
  };
}

function createInMemoryOutbound(): RelayOutboundAdapter & {
  sent: OutboundEvent[];
} {
  const sent: OutboundEvent[] = [];
  return {
    sent,
    async send(event) { sent.push(event); },
  };
}

// --- Assembly ------------------------------------------------------------

export async function assembleTraitsAssistant() {
  const inbound = createInMemoryInbound();
  const outbound = createInMemoryOutbound();

  const traits = createTraitsProvider(
    {
      voice: 'concise',
      formality: 'professional',
      proactivity: 'medium',
      riskPosture: 'moderate',
      domain: 'engineering',
      vocabulary: ['deploy', 'rollback', 'incident'],
    },
    {
      preferMarkdown: true,
      preferredResponseLength: 600,
    },
  );

  const runtime = createAssistant(
    {
      id: 'sage-assistant',
      name: 'Sage',
      description: 'A concise, professional engineering assistant.',
      traits,
      capabilities: {
        reply: async (message: InboundMessage, context) => {
          // Read traits at handling time — never mutate them.
          const def = context.runtime.definition;
          const voice = def.traits?.traits.voice;
          const markdown = def.traits?.surfaceFormatting?.preferMarkdown;
          const maxLen = def.traits?.surfaceFormatting?.preferredResponseLength ?? 1000;

          context.log.info('handling with traits', { voice, markdown });

          // Format response based on trait values
          let text = `Acknowledged: ${message.text}`;
          if (text.length > maxLen) {
            text = text.slice(0, maxLen - 3) + '...';
          }
          if (markdown) {
            text = `**Sage:** ${text}`;
          }

          await context.runtime.emit({
            surfaceId: message.surfaceId,
            text,
          });
        },
      },
    },
    { inbound, outbound },
  );

  await runtime.start();

  // Verify traits are frozen and accessible
  const frozen = runtime.definition.traits;
  console.log('Traits voice:', frozen?.traits.voice);         // → "concise"
  console.log('Prefer markdown:', frozen?.surfaceFormatting?.preferMarkdown); // → true

  // Dispatch a message
  inbound.push({
    id: 'msg-1',
    surfaceId: 'surface-slack',
    userId: 'user-eng-1',
    text: 'What is the deploy status?',
    raw: {},
    receivedAt: new Date().toISOString(),
    capability: 'reply',
  });

  await new Promise((r) => setTimeout(r, 50));

  console.log('Outbound events:', outbound.sent);
  // → [{ surfaceId: "surface-slack", text: "**Sage:** Acknowledged: What is the deploy status?" }]

  await runtime.stop();
  return { runtime, outbound };
}
