/**
 * 03 — Policy-Gated Assistant
 *
 * Shows how to wire @relay-assistant/policy into an assistant's capability
 * handler so that every user-facing action is classified, evaluated, and
 * audited before execution.
 *
 * Key pattern:
 *   The policy engine lives outside core. Product code calls
 *   policyEngine.evaluate(action) inside a capability handler and branches
 *   on the decision before emitting a response.
 */

import { createAssistant } from '@relay-assistant/core';
import type {
  InboundMessage,
  RelayInboundAdapter,
  RelayOutboundAdapter,
  OutboundEvent,
} from '@relay-assistant/core';
import {
  createActionPolicy,
  InMemoryAuditSink,
  type PolicyRule,
  type Action,
  type RiskLevel,
  type PolicyEvaluationContext,
} from '@relay-assistant/policy';

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

// --- Policy rules (product-owned) ----------------------------------------

/**
 * Block any action classified as critical risk.
 */
const blockCriticalRule: PolicyRule = {
  id: 'block-critical',
  priority: 10,
  description: 'Deny all critical-risk actions unconditionally.',
  evaluate(_action: Action, riskLevel: RiskLevel, _context: PolicyEvaluationContext) {
    if (riskLevel === 'critical') {
      return {
        action: 'deny',
        ruleId: 'block-critical',
        riskLevel,
        reason: 'Critical-risk actions are not permitted.',
      };
    }
    return null; // no opinion — fall through
  },
};

/**
 * Require approval for high-risk actions.
 */
const approveHighRiskRule: PolicyRule = {
  id: 'approve-high',
  priority: 20,
  description: 'Require human approval for high-risk actions.',
  evaluate(_action: Action, riskLevel: RiskLevel, _context: PolicyEvaluationContext) {
    if (riskLevel === 'high') {
      return {
        action: 'require_approval',
        ruleId: 'approve-high',
        riskLevel,
        reason: 'High-risk actions require human approval.',
        approvalHint: {
          approver: 'team-lead',
          timeoutMs: 300_000,
          prompt: 'A high-risk action needs your approval.',
        },
      };
    }
    return null;
  },
};

// --- Assembly ------------------------------------------------------------

export async function assemblePolicyGatedAssistant() {
  const inbound = createInMemoryInbound();
  const outbound = createInMemoryOutbound();
  const auditSink = new InMemoryAuditSink();

  const policyEngine = createActionPolicy({
    auditSink,
    fallbackDecision: 'allow',
  });

  policyEngine.registerRule(blockCriticalRule);
  policyEngine.registerRule(approveHighRiskRule);

  const runtime = createAssistant(
    {
      id: 'gated-assistant',
      name: 'Gated',
      description: 'An assistant that gates every reply through policy evaluation.',
      capabilities: {
        reply: async (message: InboundMessage, context) => {
          // Build a policy Action from the inbound message
          const action: Action = {
            id: `action-${message.id}`,
            type: 'assistant_reply',
            description: `Reply to: ${message.text}`,
            sessionId: message.sessionId ?? 'default-session',
            userId: message.userId,
            proactive: false,
          };

          const result = await policyEngine.evaluate(action);

          switch (result.decision.action) {
            case 'allow':
              context.log.info('policy: allowed');
              await context.runtime.emit({
                surfaceId: message.surfaceId,
                text: `Reply: ${message.text}`,
              });
              break;

            case 'deny':
              context.log.warn('policy: denied', { reason: result.decision.reason });
              await context.runtime.emit({
                surfaceId: message.surfaceId,
                text: `I'm unable to process that request. Reason: ${result.decision.reason}`,
              });
              break;

            case 'require_approval':
              context.log.info('policy: pending approval', {
                approver: result.decision.approvalHint?.approver,
              });
              await context.runtime.emit({
                surfaceId: message.surfaceId,
                text: 'Your request requires approval. A team lead has been notified.',
              });
              break;

            case 'escalate':
              context.log.warn('policy: escalated');
              await context.runtime.emit({
                surfaceId: message.surfaceId,
                text: 'This request has been escalated for review.',
              });
              break;
          }
        },
      },
    },
    { inbound, outbound },
  );

  await runtime.start();

  // Simulate a normal (low-risk) message
  inbound.push({
    id: 'msg-1',
    surfaceId: 'surface-web',
    userId: 'user-42',
    text: 'What time is it?',
    raw: {},
    receivedAt: new Date().toISOString(),
    capability: 'reply',
  });

  await new Promise((r) => setTimeout(r, 50));

  console.log('Outbound:', outbound.sent);
  console.log('Audit events:', auditSink.events.length);

  await runtime.stop();
  return { runtime, outbound, auditSink, policyEngine };
}
