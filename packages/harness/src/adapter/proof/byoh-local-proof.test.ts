import { describe, expect, it } from 'vitest';
import { createTurnContextAssembler } from '@agent-assistant/turn-context';

import { runByohLocalProof } from './byoh-local-proof.js';
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

describe('runByohLocalProof', () => {
  it('runs the completed proof path with relay publication and validation signals', async () => {
    const published: Array<{ channel: string; text: string; threadId: string }> = [];

    const result = await runByohLocalProof(
      {
        assembler: createTurnContextAssembler(),
        adapter: createAdapter(),
        relay: {
          async publish(input) {
            published.push(input);
            return { eventId: 'evt-1', targets: [input.channel] };
          },
        },
        relayConfig: {
          channelId: 'byoh-local-proof',
        },
      },
      {
        type: 'completed-with-tools',
        message: 'Validate the proof slice.',
        tools: [{ name: 'relay_lookup', description: 'Lookup relay evidence' }],
      },
    );

    expect(result.executionResult.status).toBe('completed');
    expect(result.validationResult.status).toBe('complete');
    expect(result.identityPreserved).toBe(true);
    expect(result.relayCoordinated).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]?.channel).toBe('byoh-local-proof');
    expect(result.signals.map((signal) => signal.signalClass)).toEqual([
      'confidence.high',
      'handoff.ready',
    ]);
  });

  it('returns an unsupported proof result for negotiation-rejected requests', async () => {
    const result = await runByohLocalProof(
      {
        assembler: createTurnContextAssembler(),
        adapter: createAdapter(),
      },
      {
        type: 'negotiation-rejected',
        message: 'Attempt attachment-heavy request.',
        requirements: { attachments: 'required' },
      },
    );

    expect(result.executionResult.status).toBe('unsupported');
    expect(result.validationResult.metadata?.validatedStatus).toBe('unsupported');
    expect(result.signals.some((signal) => signal.signalClass === 'confidence.low')).toBe(true);
  });
});
