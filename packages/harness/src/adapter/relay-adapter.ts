/**
 * RelayAdapter — Node-only convenience wrapper over the Agent Relay broker.
 *
 * `@agent-relay/sdk` shipped a `RelayAdapter` class up to 6.x. From 12.x the
 * broker client moved to `@agent-relay/harness-driver` (`HarnessDriverClient`)
 * and the SDK no longer exports `RelayAdapter`. This module keeps the same
 * small surface the harness relies on (lazy idempotent start, events
 * registered before start, safe spawn/release results) on top of
 * `HarnessDriverClient`, so consumers of `@agent-assistant/harness/agent-relay`
 * and `@agent-assistant/harness/worker-bridge` keep the same API.
 *
 * It spawns a local broker process, so it must only be imported from the
 * Node-only subpaths (`./agent-relay`, `./worker-bridge`), never from the
 * default barrel that Cloudflare Workers consumers bundle.
 */
import { HarnessDriverClient } from '@agent-relay/harness-driver';
import type {
  BrokerEvent,
  BrokerStatus,
  SendMessageInput,
  SendMessageResult,
} from '@agent-relay/harness-driver';

export type { BrokerEvent, BrokerStatus, SendMessageInput, SendMessageResult };

export interface RelayAdapterOptions {
  /** Project root directory (required — the broker locks per project). */
  cwd: string;
  /** Path to the agent-relay-broker binary. Falls back to bundled/PATH resolution. */
  binaryPath?: string;
  /** Default channels for the broker. */
  channels?: string[];
  /** Environment variables forwarded to the broker process. */
  env?: NodeJS.ProcessEnv;
  /**
   * Upper bound for a graceful `shutdown()` (broker `/api/shutdown` plus
   * process exit). When it elapses the broker process is SIGKILLed so it
   * never outlives the caller. Default: 5000ms.
   */
  shutdownTimeoutMs?: number;
}

export interface RelaySpawnRequest {
  name: string;
  cli: string;
  task?: string;
  team?: string;
  cwd?: string;
  model?: string;
  shadowMode?: string;
  shadowOf?: string;
  includeWorkflowConventions?: boolean;
  /**
   * Channels the spawned agent joins. Defaults to `['general']`, matching
   * the `@agent-relay/sdk` 6.x RelayAdapter. Agents are addressed by name;
   * joining a busy work channel injects every channel post into the agent's
   * terminal, so opt in explicitly.
   */
  channels?: string[];
}

export interface RelaySpawnResult {
  success: boolean;
  name: string;
  pid?: number;
  error?: string;
}

export interface RelayAgentInfo {
  name: string;
  cli?: string;
  pid?: number;
  channels: string[];
  parent?: string;
  runtime: string;
}

export interface RelayReleaseResult {
  success: boolean;
  name: string;
  error?: string;
}

const WORKFLOW_BOOTSTRAP_TASK =
  'You are connected to Agent Relay. Do not reply to this message and wait for relay messages and respond using Relaycast MCP tools.';

const WORKFLOW_CONVENTIONS = [
  'Messaging requirements:',
  '- When you receive `Relay message from <sender> ...`, reply using `mcp__relaycast__message_dm_send(to: "<sender>", text: "...")`.',
  '- Send `ACK: ...` when you receive a task.',
  '- Send `DONE: ...` when the task is complete.',
  '- Do not reply only in terminal text; send the response via mcp__relaycast__message_dm_send.',
  '- Use mcp__relaycast__message_inbox_check() and mcp__relaycast__agent_list() when context is missing.',
].join('\n');

function hasWorkflowConventions(task: string): boolean {
  const lower = task.toLowerCase();
  return (
    lower.includes('mcp__relaycast__message_dm_send(') ||
    lower.includes('relay_send(') ||
    (lower.includes('ack:') && lower.includes('done:'))
  );
}

function buildSpawnTask(task: string | undefined, includeWorkflowConventions?: boolean): string | undefined {
  const normalized = typeof task === 'string' ? task.trim() : '';
  if (!includeWorkflowConventions) {
    return normalized.length > 0 ? normalized : undefined;
  }
  if (normalized.length === 0) {
    return `${WORKFLOW_BOOTSTRAP_TASK}\n\n${WORKFLOW_CONVENTIONS}`;
  }
  if (hasWorkflowConventions(normalized)) {
    return normalized;
  }
  return `${normalized}\n\n${WORKFLOW_CONVENTIONS}`;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface EventSubscription {
  listener: (event: BrokerEvent) => void;
  detach: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class RelayAdapter {
  private client: HarnessDriverClient | null = null;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private readonly spawnOpts: Omit<RelayAdapterOptions, 'shutdownTimeoutMs'> & { channels: string[] };
  private readonly shutdownTimeoutMs: number;
  private readonly stderrListeners = new Set<(line: string) => void>();
  private readonly eventSubscriptions = new Set<EventSubscription>();

  constructor(opts: RelayAdapterOptions) {
    this.spawnOpts = {
      binaryPath: opts.binaryPath,
      channels: opts.channels ?? ['general'],
      cwd: opts.cwd,
      env: opts.env,
    };
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  private ensureClient(): HarnessDriverClient {
    if (!this.client) {
      throw new Error('RelayAdapter not started — call start() first');
    }
    return this.client;
  }

  /** Start the broker process. Idempotent — concurrent calls share one spawn. */
  async start(): Promise<void> {
    if (this.shutdownPromise) await this.shutdownPromise;
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(): Promise<void> {
    const client = await HarnessDriverClient.spawn({
      ...this.spawnOpts,
      onStderr: (line: string) => {
        for (const listener of this.stderrListeners) {
          try {
            listener(line);
          } catch {
            /* listener errors must not break the broker stream */
          }
        }
      },
    });
    this.client = client;
    // Attach listeners registered before start() (or before a restart).
    for (const subscription of this.eventSubscriptions) {
      subscription.detach = client.onEvent(subscription.listener);
    }
    this.started = true;
  }

  /**
   * Shut down the broker and all spawned agents.
   *
   * - Waits for an in-flight `start()` so the broker it spawns is not left
   *   running unowned.
   * - No-op when the broker never started (or startup failed), so callers can
   *   always shut down in a `finally` without masking the original error.
   * - Bounded by `shutdownTimeoutMs`; a broker still alive after that is
   *   SIGKILLed. Concurrent calls share one shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.doShutdown();
    try {
      await this.shutdownPromise;
    } finally {
      this.shutdownPromise = null;
    }
  }

  private async doShutdown(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise.catch(() => {});
    }
    const client = this.client;
    if (!client) return;
    this.client = null;
    this.started = false;
    const brokerPid = client.brokerPid;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.shutdownTimeoutMs);
    });
    let outcome: 'done' | 'timeout';
    try {
      outcome = await Promise.race([
        client.shutdown().then(
          () => 'done' as const,
          () => 'done' as const,
        ),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (outcome === 'done') return;

    // Graceful shutdown did not finish in time: drop the connection and make
    // sure the broker process is gone instead of leaving it orphaned.
    try {
      client.disconnect();
    } catch {
      /* already disconnected */
    }
    if (brokerPid !== undefined && isProcessAlive(brokerPid)) {
      try {
        process.kill(brokerPid, 'SIGKILL');
      } catch {
        /* exited between the check and the kill */
      }
    }
  }

  /** Spawn an agent via the broker's PTY runtime. */
  async spawn(req: RelaySpawnRequest): Promise<RelaySpawnResult> {
    try {
      await this.start();
      const client = this.ensureClient();
      const result = await client.spawnPty({
        name: req.name,
        cli: req.cli,
        task: buildSpawnTask(req.task, req.includeWorkflowConventions),
        channels: req.channels ?? ['general'],
        model: req.model,
        cwd: req.cwd,
        team: req.team,
        shadowOf: req.shadowOf,
        shadowMode: req.shadowMode,
      });
      let pid: number | undefined;
      try {
        const agents = await client.listAgents();
        pid = agents.find((agent) => agent.name === req.name)?.pid;
      } catch {
        /* pid is best-effort */
      }
      return { success: true, name: result.name, pid };
    } catch (err) {
      return { success: false, name: req.name, error: errorMessage(err) };
    }
  }

  /** Release (stop) a spawned agent. */
  async release(name: string, reason?: string): Promise<RelayReleaseResult> {
    try {
      await this.start();
      await this.ensureClient().release(name, reason);
      return { success: true, name };
    } catch (err) {
      return { success: false, name, error: errorMessage(err) };
    }
  }

  /** List all agents managed by this broker instance. */
  async listAgents(): Promise<RelayAgentInfo[]> {
    await this.start();
    const agents = await this.ensureClient().listAgents();
    return agents.map((agent) => ({
      name: agent.name,
      cli: agent.cli,
      pid: agent.pid,
      channels: agent.channels,
      parent: agent.parent,
      runtime: agent.runtime,
    }));
  }

  /** Check if a specific agent is spawned. */
  async hasAgent(name: string): Promise<boolean> {
    const agents = await this.listAgents();
    return agents.some((agent) => agent.name === name);
  }

  /** Get broker status (agent count, pending deliveries). */
  async getStatus(): Promise<BrokerStatus> {
    await this.start();
    return this.ensureClient().getStatus();
  }

  /** Send a message to an agent or channel. */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    await this.start();
    return this.ensureClient().sendMessage(input);
  }

  async sendInput(name: string, data: string): Promise<void> {
    await this.start();
    await this.ensureClient().sendInput(name, data);
  }

  /**
   * Subscribe to broker events. Listeners registered before `start()` are
   * attached once the broker is up.
   */
  onEvent(listener: (event: BrokerEvent) => void): () => void {
    // Each call is its own subscription, so registering the same listener
    // twice yields two independent handles.
    const subscription: EventSubscription = {
      listener,
      detach: this.client ? this.client.onEvent(listener) : () => {},
    };
    this.eventSubscriptions.add(subscription);
    return () => {
      if (!this.eventSubscriptions.delete(subscription)) return;
      subscription.detach();
    };
  }

  onStderr(listener: (line: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => {
      this.stderrListeners.delete(listener);
    };
  }

  /** Underlying harness-driver client (after `start()`). */
  get raw(): HarnessDriverClient {
    return this.ensureClient();
  }
}
