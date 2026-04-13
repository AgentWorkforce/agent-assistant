/**
 * 05 — Full Assembly
 *
 * Composes all four SDK packages into a single assistant:
 *   - @agent-assistant/core       — runtime, lifecycle, dispatch
 *   - @agent-assistant/traits     — personality and formatting traits
 *   - @agent-assistant/policy     — action classification, gating, audit
 *   - @agent-assistant/proactive  — follow-up rules, watch rules
 *
 * The integration helpers (followUpToAction, watchTriggerToAction) bridge
 * proactive decisions into policy evaluation. This is the canonical
 * composition pattern — product code owns the orchestration glue.
 *
 * Architecture:
 *   ┌─────────────┐     ┌────────────┐
 *   │  Proactive   │────▶│  Policy    │
 *   │  Engine      │     │  Engine    │
 *   └──────┬───────┘     └─────┬──────┘
 *          │ decisions         │ allow/deny
 *          ▼                   ▼
 *   ┌──────────────────────────────────┐
 *   │        Core Runtime              │
 *   │  ┌──────────┐  ┌─────────────┐  │
 *   │  │  Traits   │  │ Capabilities│  │
 *   │  └──────────┘  └─────────────┘  │
 *   └──────────────────────────────────┘
 */

import {
  createAssistant,
  createTraitsProvider,
  createActionPolicy,
  InMemoryAuditSink,
  createProactiveEngine,
  InMemorySchedulerBinding,
} from '@agent-assistant/sdk';
import type {
  InboundMessage,
  AssistantRuntime,
  OutboundEvent,
  PolicyEngine,
  PolicyRule,
  Action,
  RiskLevel,
  ProactiveEngine,
  FollowUpRule,
} from '@agent-assistant/sdk';
import type { RelayInboundAdapter, RelayOutboundAdapter } from '@agent-assistant/core';
import type { PolicyEvaluationContext } from '@agent-assistant/policy';
import type { FollowUpDecision, WatchTrigger } from '@agent-assistant/proactive';

// --- Integration helpers -------------------------------------------------
// In a real repo these would come from a shared integration package.
// Inlined here so the example is self-contained.

function followUpToAction(
  decision: FollowUpDecision,
  userId: string,
  id: string,
): Action {
  return {
    id,
    type: 'proactive_follow_up',
    description:
      decision.messageTemplate ?? `Proactive follow-up from rule ${decision.ruleId}`,
    sessionId: decision.sessionId,
    userId,
    proactive: true,
    metadata: {
      sourceRuleId: decision.ruleId,
      routingHint: decision.routingHint,
    },
  };
}

function watchTriggerToAction(
  trigger: WatchTrigger,
  sessionId: string,
  userId: string,
  id: string,
): Action {
  return {
    id,
    type: `proactive_watch_${trigger.action.type}`,
    description: `Watch rule ${trigger.ruleId} triggered: ${trigger.action.type}`,
    sessionId,
    userId,
    proactive: true,
    metadata: {
      sourceRuleId: trigger.ruleId,
      watchAction: trigger.action,
      triggeredAt: trigger.triggeredAt,
    },
  };
}

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

// --- Policy rules --------------------------------------------------------

const blockCriticalRule: PolicyRule = {
  id: 'block-critical',
  priority: 10,
  evaluate(_action: Action, riskLevel: RiskLevel, _context: PolicyEvaluationContext) {
    return riskLevel === 'critical'
      ? { action: 'deny', ruleId: 'block-critical', riskLevel, reason: 'Critical risk.' }
      : null;
  },
};

const approveHighRiskProactiveRule: PolicyRule = {
  id: 'approve-proactive-high',
  priority: 20,
  description: 'Require approval for high-risk proactive actions.',
  evaluate(action: Action, riskLevel: RiskLevel, _context: PolicyEvaluationContext) {
    if (action.proactive && riskLevel === 'high') {
      return {
        action: 'require_approval',
        ruleId: 'approve-proactive-high',
        riskLevel,
        reason: 'Proactive high-risk actions need approval.',
        approvalHint: { approver: 'oncall', timeoutMs: 600_000 },
      };
    }
    return null;
  },
};

// --- Proactive rules -----------------------------------------------------

const idleFollowUp: FollowUpRule = {
  id: 'idle-check-in',
  routingHint: 'cheap',
  messageTemplate: 'Checking in — anything else you need?',
  policy: { maxReminders: 2, cooldownMs: 3_600_000, suppressWhenActive: true },
  condition(ctx) {
    const idle = new Date(ctx.scheduledAt).getTime() - new Date(ctx.lastActivityAt).getTime();
    return idle > 3_600_000;
  },
};

// --- Full Assembly -------------------------------------------------------

export async function assembleFullAssistant() {
  const inbound = createInMemoryInbound();
  const outbound = createInMemoryOutbound();
  const auditSink = new InMemoryAuditSink();
  const scheduler = new InMemorySchedulerBinding();

  // 1. Create the policy engine
  const policyEngine = createActionPolicy({ auditSink, fallbackDecision: 'allow' });
  policyEngine.registerRule(blockCriticalRule);
  policyEngine.registerRule(approveHighRiskProactiveRule);

  // 2. Create the proactive engine
  const proactiveEngine = createProactiveEngine({ schedulerBinding: scheduler });
  proactiveEngine.registerFollowUpRule(idleFollowUp);

  // 3. Create traits
  const traits = createTraitsProvider(
    {
      voice: 'concise',
      formality: 'professional',
      proactivity: 'medium',
      riskPosture: 'moderate',
      domain: 'engineering',
    },
    { preferMarkdown: true, preferredResponseLength: 600 },
  );

  // 4. Assemble the runtime
  const runtime = createAssistant(
    {
      id: 'full-assistant',
      name: 'Full',
      description: 'Full assembly with traits, policy, and proactive engines.',
      traits,
      capabilities: {
        reply: async (message: InboundMessage, context) => {
          // Gate the reply through policy
          const action: Action = {
            id: `action-${message.id}`,
            type: 'assistant_reply',
            description: `Reply to: ${message.text}`,
            sessionId: message.sessionId ?? 'default-session',
            userId: message.userId,
            proactive: false,
          };

          const result = await policyEngine.evaluate(action);

          if (result.decision.action !== 'allow') {
            context.log.warn('reply blocked by policy', { decision: result.decision.action });
            await context.runtime.emit({
              surfaceId: message.surfaceId,
              text: `Request blocked: ${result.decision.reason ?? 'policy denied'}`,
            });
            return;
          }

          // Apply traits-aware formatting
          const markdown = context.runtime.definition.traits?.surfaceFormatting?.preferMarkdown;
          let text = `Acknowledged: ${message.text}`;
          if (markdown) {
            text = `**Full:** ${text}`;
          }

          await context.runtime.emit({ surfaceId: message.surfaceId, text });
        },
      },
      hooks: {
        async onStart(rt) {
          rt.register('policy', policyEngine);
          rt.register('proactive', proactiveEngine);
        },
        onError(error, message) {
          console.error(`[full] error for ${message.id}:`, error.message);
        },
      },
    },
    { inbound, outbound },
  );

  await runtime.start();

  // --- Exercise the assembly ---

  // A. Normal inbound reply (should be allowed)
  inbound.push({
    id: 'msg-1',
    surfaceId: 'surface-web',
    userId: 'user-42',
    text: 'Show deploy status',
    raw: {},
    receivedAt: new Date().toISOString(),
    capability: 'reply',
  });

  await new Promise((r) => setTimeout(r, 50));
  console.log('A. Reply output:', outbound.sent.at(-1)?.text);

  // B. Proactive follow-up → policy evaluation
  const decisions = await proactiveEngine.evaluateFollowUp({
    sessionId: 'session-abc',
    scheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
    lastActivityAt: new Date(Date.now() - 3_700_000).toISOString(),
  });

  for (const decision of decisions) {
    if (decision.action === 'fire') {
      // Bridge proactive → policy
      const policyAction = followUpToAction(decision, 'user-42', `fu-${decision.ruleId}`);
      const policyResult = await policyEngine.evaluate(policyAction);
      console.log(`B. Follow-up ${decision.ruleId}: policy=${policyResult.decision.action}`);

      if (policyResult.decision.action === 'allow') {
        await runtime.emit({
          surfaceId: 'surface-web',
          text: decision.messageTemplate ?? 'Follow-up',
        });
      }
    }
  }

  console.log('Total audit events:', auditSink.events.length);
  console.log('Total outbound events:', outbound.sent.length);

  await runtime.stop();

  return {
    runtime,
    outbound,
    policyEngine,
    proactiveEngine,
    auditSink,
    scheduler,
  };
}
