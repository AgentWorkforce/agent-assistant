import { describe, expect, it } from 'vitest';
import { createTurnContextAssembler } from '@agent-assistant/turn-context';

import { runByohLocalProof } from './byoh-local-proof.js';
import type {
  ProofRelayTransport,
  RelayChannelMessage,
  RelaySubscription,
} from './byoh-local-proof.js';
import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from '../types.js';

function createAdapter(resultFactory?: (request: ExecutionRequest) => ExecutionResult): ExecutionAdapter {
  return {
    backendId: 'claude-code',
    describeCapabilities() {
      return {
        toolUse: 'native-iterative',
        structuredToolCalls: true,
        continuationSupport: 'none',
        approvalInterrupts: 'none',
        traceDepth: 'minimal',
        attachments: false,
        maxContextStrategy: 'large',
      };
    },
    negotiate(request) {
      if (request.requirements?.attachments === 'required') {
        return {
          supported: false,
          degraded: false,
          reasons: [
            {
              code: 'attachments_unsupported',
              message: 'Attachments are not supported in the local proof slice.',
              severity: 'blocking',
            },
          ],
          effectiveCapabilities: this.describeCapabilities(),
        };
      }

      if (request.requirements?.approvalInterrupts === 'preferred') {
        return {
          supported: true,
          degraded: true,
          reasons: [
            {
              code: 'approval_interrupt_unsupported',
              message: 'Approval interrupts are not available in this proof slice.',
              severity: 'warning',
            },
          ],
          effectiveCapabilities: this.describeCapabilities(),
        };
      }

      return {
        supported: true,
        degraded: false,
        reasons: [],
        effectiveCapabilities: this.describeCapabilities(),
      };
    },
    async execute(request) {
      return (
        resultFactory?.(request) ?? {
          backendId: 'claude-code',
          status: 'completed',
          output: {
            text: `Handled: ${request.message.text}`,
          },
          trace: {
            summary: {
              startedAt: '2026-04-15T12:00:00.000Z',
              completedAt: '2026-04-15T12:00:01.000Z',
              stepCount: 1,
              toolCallCount: request.tools?.length ?? 0,
              degraded: false,
            },
          },
        }
      );
    },
  };
}

function createInMemoryRelayTransport(options?: {
  dropValidationVerdict?: boolean;
}): ProofRelayTransport & {
  published: RelayChannelMessage[];
  registeredAgents: string[];
} {
  const subscribers = new Map<
    string,
    Array<{
      agentId: string;
      filter?: (message: RelayChannelMessage) => boolean;
      queued: RelayChannelMessage[];
      waiters: Array<{
        resolve: (message: RelayChannelMessage) => void;
        reject: (error: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      }>;
      active: boolean;
    }>
  >();
  const published: RelayChannelMessage[] = [];
  const registeredAgents: string[] = [];
  let nextEventId = 1;

  const deliver = (message: RelayChannelMessage) => {
    for (const subscriber of subscribers.get(message.channel) ?? []) {
      if (!subscriber.active) {
        continue;
      }
      if (subscriber.filter && !subscriber.filter(message)) {
        continue;
      }

      const waiter = subscriber.waiters.shift();
      if (waiter) {
        if (waiter.timer) {
          clearTimeout(waiter.timer);
        }
        waiter.resolve(message);
      } else {
        subscriber.queued.push(message);
      }
    }
  };

  return {
    published,
    registeredAgents,
    async registerAgent(input) {
      registeredAgents.push(input.agentId);
      if (!subscribers.has(input.channel)) {
        subscribers.set(input.channel, []);
      }
    },
    async publish(input) {
      const message: RelayChannelMessage = {
        eventId: `evt-${nextEventId++}`,
        from: input.from ?? 'unknown',
        channel: input.channel,
        threadId: input.threadId,
        text: input.text,
        receivedAt: new Date(nextEventId * 1000).toISOString(),
      };
      published.push(message);

      const parsed = JSON.parse(message.text) as { type?: string };
      if (!(options?.dropValidationVerdict && parsed.type === 'validation-verdict')) {
        deliver(message);
      }

      return { eventId: message.eventId, targets: [input.channel] };
    },
    subscribe(input): RelaySubscription {
      const subscriber = {
        agentId: input.agentId,
        filter: input.filter,
        queued: [] as RelayChannelMessage[],
        waiters: [] as Array<{
          resolve: (message: RelayChannelMessage) => void;
          reject: (error: Error) => void;
          timer?: ReturnType<typeof setTimeout>;
        }>,
        active: true,
      };
      subscribers.set(input.channel, [...(subscribers.get(input.channel) ?? []), subscriber]);

      return {
        waitForMessage(timeoutMs = 30_000) {
          const next = subscriber.queued.shift();
          if (next) {
            return Promise.resolve(next);
          }

          return new Promise<RelayChannelMessage>((resolve, reject) => {
            const waiter = { resolve, reject } as {
              resolve: (message: RelayChannelMessage) => void;
              reject: (error: Error) => void;
              timer?: ReturnType<typeof setTimeout>;
            };
            waiter.timer = setTimeout(() => {
              const index = subscriber.waiters.indexOf(waiter);
              if (index >= 0) {
                subscriber.waiters.splice(index, 1);
              }
              reject(new Error(`Timed out waiting for Relay message on channel "${input.channel}".`));
            }, timeoutMs);
            subscriber.waiters.push(waiter);
          });
        },
        unsubscribe() {
          subscriber.active = false;
          for (const waiter of subscriber.waiters.splice(0)) {
            if (waiter.timer) {
              clearTimeout(waiter.timer);
            }
            waiter.reject(new Error(`Relay subscription for "${subscriber.agentId}" was closed.`));
          }
        },
      };
    },
  };
}

describe('runByohLocalProof', () => {
  const scenarios = [
    {
      name: 'completed-no-tools',
      scenario: { type: 'completed-no-tools', message: 'Validate the proof slice.' } as const,
      expectedValidationStatus: 'completed',
      expectedSignalClasses: ['confidence.high', 'handoff.ready'],
    },
    {
      name: 'completed-with-tools',
      scenario: {
        type: 'completed-with-tools',
        message: 'Validate the proof slice.',
        tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
      } as const,
      expectedValidationStatus: 'completed',
      expectedSignalClasses: ['confidence.high', 'handoff.ready'],
    },
    {
      name: 'negotiation-rejected',
      scenario: {
        type: 'negotiation-rejected',
        message: 'Attempt attachment-heavy request.',
        requirements: { attachments: 'required' },
      } as const,
      expectedValidationStatus: 'unsupported',
      expectedSignalClasses: ['confidence.low', 'handoff.ready'],
    },
    {
      name: 'negotiation-degraded',
      scenario: {
        type: 'negotiation-degraded',
        message: 'Attempt approval-aware request.',
        requirements: { approvalInterrupts: 'preferred' },
      } as const,
      expectedValidationStatus: 'completed',
      expectedSignalClasses: ['escalation.uncertainty', 'handoff.ready'],
    },
  ];

  for (const testCase of scenarios) {
    it(`routes ${testCase.name} through a Relay-native round trip`, async () => {
      const relay = createInMemoryRelayTransport();

      const result = await runByohLocalProof(
        {
          assembler: createTurnContextAssembler(),
          adapter: createAdapter(),
          relay,
          relayConfig: {
            channelId: 'byoh-local-proof',
          },
          timeoutMs: 50,
        },
        testCase.scenario,
      );

      expect(result.executionResult.status).toBe(
        testCase.name === 'negotiation-rejected' ? 'unsupported' : 'completed',
      );
      expect(result.validationVerdict.validatedStatus).toBe(testCase.expectedValidationStatus);
      expect(result.identityPreserved).toBe(true);
      expect(result.relayCoordinated).toBe(true);
      expect(result.relayRoundTrip.resultPublished).toBe(true);
      expect(result.relayRoundTrip.verdictReceived).toBe(true);
      expect(relay.registeredAgents).toEqual(['orchestrator', 'validation-specialist']);
      expect(relay.published).toHaveLength(2);
      expect(JSON.parse(relay.published[0]!.text).type).toBe('execution-result');
      expect(JSON.parse(relay.published[1]!.text).type).toBe('validation-verdict');
      expect(result.signals.map((signal) => signal.signalClass)).toEqual(testCase.expectedSignalClasses);
    });
  }

  it('fails when Relay drops the specialist verdict, proving Relay is structurally required', async () => {
    const relay = createInMemoryRelayTransport({ dropValidationVerdict: true });

    await expect(
      runByohLocalProof(
        {
          assembler: createTurnContextAssembler(),
          adapter: createAdapter(),
          relay,
          relayConfig: {
            channelId: 'byoh-local-proof',
          },
          timeoutMs: 20,
        },
        {
          type: 'completed-with-tools',
          message: 'Validate the proof slice.',
          tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
        },
      ),
    ).rejects.toThrow('Timed out waiting for Relay message');

    expect(relay.published).toHaveLength(2);
    expect(JSON.parse(relay.published[0]!.text).type).toBe('execution-result');
    expect(JSON.parse(relay.published[1]!.text).type).toBe('validation-verdict');
  });
});
