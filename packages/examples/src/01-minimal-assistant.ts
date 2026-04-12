/**
 * 01 — Minimal Assistant (core only)
 *
 * The simplest possible assembly: a single "reply" capability that echoes
 * inbound messages back through the outbound adapter. No traits, no policy,
 * no proactive engine.
 *
 * Run path:
 *   inbound adapter → dispatch → "reply" capability → emit → outbound adapter
 */

import {
  createAssistant,
  type InboundMessage,
} from '@agent-assistant/core';
import type {
  RelayInboundAdapter,
  RelayOutboundAdapter,
  OutboundEvent,
} from '@agent-assistant/core';

// --- Adapters (product-owned) -------------------------------------------

/**
 * A trivial in-memory inbound adapter.
 * In production this would be backed by a WebSocket, HTTP long-poll, or
 * message queue consumer.
 */
function createInMemoryInbound(): RelayInboundAdapter & {
  push(message: InboundMessage): void;
} {
  let handler: ((message: InboundMessage) => void) | null = null;

  return {
    onMessage(h) {
      handler = h;
    },
    offMessage() {
      handler = null;
    },
    push(message) {
      handler?.(message);
    },
  };
}

/**
 * A trivial outbound adapter that collects sent events for inspection.
 */
function createInMemoryOutbound(): RelayOutboundAdapter & {
  sent: OutboundEvent[];
} {
  const sent: OutboundEvent[] = [];
  return {
    sent,
    async send(event) {
      sent.push(event);
    },
  };
}

// --- Assembly ------------------------------------------------------------

export async function assembleMinimalAssistant() {
  const inbound = createInMemoryInbound();
  const outbound = createInMemoryOutbound();

  const runtime = createAssistant(
    {
      id: 'echo-assistant',
      name: 'Echo',
      description: 'Echoes every inbound message back to its surface.',
      capabilities: {
        reply: async (message: InboundMessage, context) => {
          context.log.info('echoing message');
          await context.runtime.emit({
            surfaceId: message.surfaceId,
            text: `Echo: ${message.text}`,
          });
        },
      },
      hooks: {
        onError(error, message) {
          console.error(`[echo] error for message ${message.id}:`, error.message);
        },
      },
    },
    { inbound, outbound },
  );

  await runtime.start();

  // Simulate an inbound message
  inbound.push({
    id: 'msg-1',
    surfaceId: 'surface-web',
    userId: 'user-42',
    text: 'Hello, assistant!',
    raw: {},
    receivedAt: new Date().toISOString(),
    capability: 'reply',
  });

  // Give the async dispatch a tick to settle
  await new Promise((r) => setTimeout(r, 50));

  console.log('Outbound events:', outbound.sent);
  // → [{ surfaceId: "surface-web", text: "Echo: Hello, assistant!" }]

  await runtime.stop();
  return { runtime, outbound };
}
