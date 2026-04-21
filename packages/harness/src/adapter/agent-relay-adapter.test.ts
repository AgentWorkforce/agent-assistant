import { describe, expect, it } from 'vitest';
import type { BrokerEvent, RelaySpawnRequest, SendMessageInput } from '@agent-relay/sdk';

import {
  AGENT_RELAY_EXECUTION_REQUEST_TYPE,
  AGENT_RELAY_EXECUTION_RESULT_TYPE,
  AgentRelayExecutionAdapter,
} from './agent-relay-adapter.js';
import type { AgentRelayExecutionTransport } from './agent-relay-adapter.js';
import type { ExecutionRequest, ExecutionResult } from './types.js';

function baseRequest(): ExecutionRequest {
  return {
    assistantId: 'assistant-1',
    turnId: 'turn-1',
    threadId: 'thread-1',
    message: {
      id: 'msg-1',
      text: 'Inspect local deployment state.',
      receivedAt: '2026-04-21T10:00:00.000Z',
    },
    instructions: {
      systemPrompt: 'You are Sage.',
      developerPrompt: 'Use the local harness.',
    },
    tools: [{ name: 'Bash(git status:*)', description: 'Inspect repo status.' }],
    requirements: {
      toolUse: 'allowed',
      structuredToolCalls: 'preferred',
      traceDepth: 'standard',
      attachments: 'forbidden',
    },
  };
}

class FakeRelayTransport implements AgentRelayExecutionTransport {
  started = false;
  sent: SendMessageInput[] = [];
  spawned: RelaySpawnRequest[] = [];
  agents: Array<{ name: string }> = [];
  private listeners: Array<(event: BrokerEvent) => void> = [];

  constructor(private readonly options: {
    respond?: boolean;
    failSend?: boolean;
    failSpawn?: boolean;
    responseBody?: (input: SendMessageInput) => Record<string, unknown>;
  } = {}) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async sendMessage(input: SendMessageInput): Promise<{ event_id: string; targets: string[] }> {
    if (this.options.failSend) {
      throw new Error('publish failed');
    }

    this.sent.push(input);
    if (this.options.respond ?? true) {
      const requestMessage = JSON.parse(input.text) as { turnId: string; threadId: string };
      queueMicrotask(() => {
        const body = this.options.responseBody?.(input) ?? {
          type: AGENT_RELAY_EXECUTION_RESULT_TYPE,
          turnId: requestMessage.turnId,
          threadId: requestMessage.threadId,
          executionResult: {
            backendId: 'worker-backend',
            status: 'completed',
            output: {
              text: 'Relay worker completed the turn.',
            },
          } satisfies ExecutionResult,
        };

        this.emit({
          kind: 'relay_inbound',
          event_id: 'evt-result-1',
          from: 'local-worker',
          target: input.from ?? 'agent-assistant',
          thread_id: input.threadId,
          body: JSON.stringify(body),
        });
      });
    }

    return { event_id: 'evt-request-1', targets: [input.to] };
  }

  onEvent(listener: (event: BrokerEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async listAgents(): Promise<Array<{ name: string }>> {
    return this.agents;
  }

  async spawn(request: RelaySpawnRequest): Promise<{ success: boolean; name: string }> {
    if (this.options.failSpawn) {
      return { success: false, name: request.name };
    }

    this.spawned.push(request);
    this.agents.push({ name: request.name });
    return { success: true, name: request.name };
  }

  emit(event: BrokerEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

describe('AgentRelayExecutionAdapter', () => {
  it('publishes a typed execution request and maps a typed Relay result', async () => {
    const relay = new FakeRelayTransport();
    const adapter = new AgentRelayExecutionAdapter({
      relay,
      workerName: 'local-worker',
      orchestratorName: 'nightcto',
      channelId: 'nightcto-local',
      now: () => new Date('2026-04-21T10:00:00.000Z').getTime(),
    });

    const result = await adapter.execute(baseRequest());

    expect(relay.started).toBe(true);
    expect(relay.sent).toHaveLength(1);
    expect(relay.sent[0]).toMatchObject({
      to: 'local-worker',
      from: 'nightcto',
      threadId: 'thread-1',
      data: {
        type: AGENT_RELAY_EXECUTION_REQUEST_TYPE,
        turnId: 'turn-1',
        threadId: 'thread-1',
      },
    });
    expect(JSON.parse(relay.sent[0]!.text)).toMatchObject({
      type: AGENT_RELAY_EXECUTION_REQUEST_TYPE,
      turnId: 'turn-1',
      threadId: 'thread-1',
      request: {
        assistantId: 'assistant-1',
        message: { text: 'Inspect local deployment state.' },
      },
      replyTo: {
        agentId: 'nightcto',
        channelId: 'nightcto-local',
      },
    });
    expect(result).toMatchObject({
      backendId: 'agent-relay',
      status: 'completed',
      output: {
        text: 'Relay worker completed the turn.',
      },
      metadata: {
        relay: {
          workerBackendId: 'worker-backend',
          channelId: 'nightcto-local',
          target: 'local-worker',
        },
      },
    });
  });

  it('normalizes a practical worker result that uses status ok and answer', async () => {
    const relay = new FakeRelayTransport({
      responseBody(input) {
        const requestMessage = JSON.parse(input.text) as { turnId: string; threadId: string };

        return {
          type: AGENT_RELAY_EXECUTION_RESULT_TYPE,
          turnId: requestMessage.turnId,
          threadId: requestMessage.threadId,
          assistantId: 'nightcto-local-chat',
          executionResult: {
            backendId: 'custom-worker',
            status: 'ok',
            answer: 'E2E_OK: local git status was inspected.',
            structured: {
              repoStatus: 'dirty',
            },
            toolCalls: [
              {
                name: 'Bash(git status:*)',
                input: { command: 'git status' },
                output: 'On branch codex/example; no staged changes.',
              },
            ],
          },
        };
      },
    });
    const adapter = new AgentRelayExecutionAdapter({
      relay,
      workerName: 'local-worker',
      orchestratorName: 'nightcto',
      channelId: 'nightcto-local',
    });

    const result = await adapter.execute(baseRequest());

    expect(result).toMatchObject({
      backendId: 'agent-relay',
      status: 'completed',
      output: {
        text: 'E2E_OK: local git status was inspected.',
        structured: {
          repoStatus: 'dirty',
          toolCalls: [
            {
              name: 'Bash(git status:*)',
            },
          ],
        },
      },
      metadata: {
        relay: {
          workerBackendId: 'custom-worker',
        },
        normalizedFromRelayWorker: true,
      },
    });
  });

  it('auto-spawns the configured worker before publishing when requested', async () => {
    const relay = new FakeRelayTransport();
    const adapter = new AgentRelayExecutionAdapter({
      relay,
      workerName: 'local-worker',
      spawnWorker: {
        enabled: true,
        cli: 'claude',
        model: 'sonnet',
      },
    });

    await adapter.execute(baseRequest());

    expect(relay.spawned).toHaveLength(1);
    expect(relay.spawned[0]).toMatchObject({
      name: 'local-worker',
      cli: 'claude',
      model: 'sonnet',
      includeWorkflowConventions: true,
    });
  });

  it('maps Relay publish failures to retryable backend execution errors', async () => {
    const adapter = new AgentRelayExecutionAdapter({
      relay: new FakeRelayTransport({ failSend: true }),
      timeoutMs: 50,
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('backend_execution_error');
    expect(result.error?.retryable).toBe(true);
  });

  it('maps worker spawn failures to retryable backend execution errors', async () => {
    const adapter = new AgentRelayExecutionAdapter({
      relay: new FakeRelayTransport({ failSpawn: true }),
      workerName: 'local-worker',
      spawnWorker: {
        enabled: true,
        cli: 'claude',
      },
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('backend_execution_error');
    expect(result.error?.retryable).toBe(true);
  });

  it('times out when no matching execution result arrives', async () => {
    const adapter = new AgentRelayExecutionAdapter({
      relay: new FakeRelayTransport({ respond: false }),
      timeoutMs: 5,
    });

    const result = await adapter.execute(baseRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.retryable).toBe(true);
  });

  it('reports unsupported negotiation for attachment-required turns', () => {
    const adapter = new AgentRelayExecutionAdapter();
    const negotiation = adapter.negotiate({
      ...baseRequest(),
      message: {
        ...baseRequest().message,
        attachments: [{ id: 'att-1', type: 'image/png' }],
      },
      requirements: {
        attachments: 'required',
      },
    });

    expect(negotiation.supported).toBe(false);
    expect(negotiation.reasons[0]?.code).toBe('attachments_unsupported');
  });
});
