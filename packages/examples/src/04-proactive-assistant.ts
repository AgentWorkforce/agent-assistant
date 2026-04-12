/**
 * 04 — Proactive Assistant
 *
 * Demonstrates the proactive engine from @relay-assistant/proactive wired
 * into a core assistant. The proactive engine manages follow-up rules (session
 * re-engagement) and watch rules (periodic condition checks). The assistant's
 * onStart hook registers rules and its capabilities act on proactive decisions.
 *
 * Key pattern:
 *   The proactive engine is a standalone subsystem registered on the runtime.
 *   Evaluation is triggered by the product's scheduler, not by inbound
 *   messages. Follow-up and watch decisions flow back through the assistant's
 *   capabilities or emit path.
 */

import { createAssistant } from '@relay-assistant/core';
import type {
  InboundMessage,
  RelayInboundAdapter,
  RelayOutboundAdapter,
  OutboundEvent,
} from '@relay-assistant/core';
import {
  createProactiveEngine,
  InMemorySchedulerBinding,
  type FollowUpRule,
  type WatchRule,
  type ProactiveEngine,
} from '@relay-assistant/proactive';

// --- Adapters ------------------------------------------------------------

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

// --- Proactive rules (product-owned) -------------------------------------

const idleFollowUpRule: FollowUpRule = {
  id: 'idle-check-in',
  description: 'Follow up when a session has been idle for over an hour.',
  routingHint: 'cheap',
  messageTemplate: 'Just checking in — need anything else?',
  policy: {
    maxReminders: 2,
    cooldownMs: 3_600_000, // 1 hour
    suppressWhenActive: true,
  },
  condition(ctx) {
    const lastActivity = new Date(ctx.lastActivityAt).getTime();
    const scheduled = new Date(ctx.scheduledAt).getTime();
    const idleMs = scheduled - lastActivity;
    return idleMs > 3_600_000; // idle > 1 hour
  },
};

const deployWatchRule: WatchRule = {
  id: 'deploy-status-watch',
  description: 'Check deploy pipeline status every 5 minutes.',
  intervalMs: 300_000, // 5 minutes
  action: {
    type: 'notify_deploy_status',
    payload: { pipeline: 'main' },
  },
  condition(_ctx) {
    // In production this would call a CI/CD API.
    // For the example, always fire on evaluation.
    return true;
  },
};

// --- Assembly ------------------------------------------------------------

export async function assembleProactiveAssistant() {
  const inbound = createInMemoryInbound();
  const outbound = createInMemoryOutbound();
  const scheduler = new InMemorySchedulerBinding();

  const proactiveEngine = createProactiveEngine({
    schedulerBinding: scheduler,
  });

  proactiveEngine.registerFollowUpRule(idleFollowUpRule);
  await proactiveEngine.registerWatchRule(deployWatchRule);

  const runtime = createAssistant(
    {
      id: 'proactive-assistant',
      name: 'Proactive',
      description: 'An assistant that proactively follows up and watches conditions.',
      capabilities: {
        reply: async (message: InboundMessage, context) => {
          context.log.info('handling reply');
          await context.runtime.emit({
            surfaceId: message.surfaceId,
            text: `Got it: ${message.text}`,
          });
        },
      },
      hooks: {
        async onStart(rt) {
          // Register the proactive engine as a subsystem so other code
          // can access it via runtime.get('proactive').
          rt.register('proactive', proactiveEngine);
        },
      },
    },
    { inbound, outbound },
  );

  await runtime.start();

  // Simulate a follow-up evaluation (triggered by the scheduler)
  const followUpDecisions = await proactiveEngine.evaluateFollowUp({
    sessionId: 'session-abc',
    scheduledAt: new Date(Date.now() + 7_200_000).toISOString(), // 2h from now
    lastActivityAt: new Date(Date.now() - 3_700_000).toISOString(), // idle > 1h
  });

  for (const decision of followUpDecisions) {
    if (decision.action === 'fire') {
      console.log(`Follow-up fires for session ${decision.sessionId}:`, decision.messageTemplate);
      // Product code would emit the follow-up through the runtime here
    } else {
      console.log(`Follow-up suppressed: ${decision.suppressionReason}`);
    }
  }

  // Simulate a watch rule evaluation
  const watchTriggers = await proactiveEngine.evaluateWatchRules({
    ruleId: 'deploy-status-watch',
    scheduledAt: new Date().toISOString(),
  });

  for (const trigger of watchTriggers) {
    console.log(`Watch triggered: ${trigger.ruleId} → ${trigger.action.type}`);
  }

  // Retrieve the engine from the runtime subsystem registry
  const engine = runtime.get<ProactiveEngine>('proactive');
  console.log('Registered follow-up rules:', engine.listFollowUpRules().length);
  console.log('Registered watch rules:', engine.listWatchRules().length);

  await runtime.stop();
  return { runtime, outbound, proactiveEngine, scheduler };
}
