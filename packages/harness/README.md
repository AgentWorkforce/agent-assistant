# `@agent-assistant/harness`

`@agent-assistant/harness` is the bounded runtime for one assistant turn with iterative model/tool/model execution, truthful stop semantics, structured continuation payloads, and trace hooks.

It exists to fill the gap between a thin one-shot assistant runtime and an unbounded autonomous agent framework.

## What It Owns

- bounded execution for a single assistant turn
- iterative model/tool/model loop
- truthful outcomes: `completed`, `needs_clarification`, `awaiting_approval`, `deferred`, `failed`
- explicit stop reasons
- compact continuation payloads for clarification, approval, and deferred resume
- trace/telemetry lifecycle events
- adapter seams for model, tools, approvals, and trace sinks

## What It Does Not Own

- assistant lifecycle or runtime registration (`@agent-assistant/core`)
- sessions persistence (`@agent-assistant/sessions`)
- memory storage or retrieval (`@agent-assistant/memory`)
- routing policy ownership (`@agent-assistant/routing`)
- approvals policy ownership (`@agent-assistant/policy`)
- coordination/workflow engines (`@agent-assistant/coordination`)
- workforce persona definitions

## Installation

```bash
npm install @agent-assistant/harness
```

## Workspace VFS Tools

`createWorkspaceToolRegistry` exposes provider-neutral `workspace_search`, `workspace_list`, `workspace_read`, and `workspace_read_json` tools for assistants that have a `VfsProvider` from `@agent-assistant/vfs`. The tools emit VFS paths, including `sourcePath`-style structured outputs for JSON reads, so callers can cite file paths in user-visible replies instead of answering workspace questions from memory.

## Quick Example

```ts
import { createHarness } from '@agent-assistant/harness';

const harness = createHarness({
  model: {
    async nextStep(input) {
      if (input.toolCallCount === 0) {
        return {
          type: 'tool_request',
          calls: [
            {
              id: 'call-1',
              name: 'lookup_weather',
              input: { city: 'Oslo' },
            },
          ],
        };
      }

      return {
        type: 'final_answer',
        text: 'It looks chilly in Oslo today.',
      };
    },
  },
  tools: {
    async listAvailable() {
      return [{ name: 'lookup_weather', description: 'Get current weather' }];
    },
    async execute(call) {
      return {
        callId: call.id,
        toolName: call.name,
        status: 'success',
        output: '{"temperatureC":8}',
      };
    },
  },
});

const result = await harness.runTurn({
  assistantId: 'sage',
  turnId: 'turn-123',
  sessionId: 'session-123',
  message: {
    id: 'msg-1',
    text: 'What is the weather in Oslo?',
    receivedAt: new Date().toISOString(),
  },
  instructions: {
    systemPrompt: 'You are Sage. Be concise and truthful.',
  },
});
```

## OpenRouter execution adapter

The harness package now also exposes a bounded hosted execution adapter for OpenRouter-backed turns.

### What it is

The `OpenRouterExecutionAdapter` is a direct hosted backend behind the existing `ExecutionAdapter` seam.

This means Agent Assistant still owns:
- assistant identity
- turn-context assembly
- policy
- continuation semantics
- Relay-native collaboration

The adapter only owns:
- request translation
- backend invocation
- output normalization
- truthful capability/degradation reporting

### Current scope

This adapter is intentionally narrow in the current slice:
- backend id: `openrouter-api`
- direct hosted API execution
- no-tool turns only
- minimal trace facts
- truthful `unsupported` / degraded negotiation

### Current non-goals

This adapter does **not** currently support:
- tool-bearing execution
- structured tool calls
- attachments
- structured continuation support
- approval interrupts

### Example

```ts
import {
  OpenRouterExecutionAdapter,
  type ExecutionRequest,
} from '@agent-assistant/harness';

const adapter = new OpenRouterExecutionAdapter({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'openai/gpt-5-mini',
});

const request: ExecutionRequest = {
  assistantId: 'sage',
  turnId: 'turn-456',
  message: {
    id: 'msg-2',
    text: 'Summarize the current PR status.',
    receivedAt: new Date().toISOString(),
  },
  instructions: {
    systemPrompt: 'You are Sage. Be concise and truthful.',
    developerPrompt: 'Do not invent missing GitHub state.',
  },
  context: {
    blocks: [
      {
        id: 'ctx-1',
        label: 'Scope',
        text: 'Only summarize what is present in the supplied context.',
      },
    ],
  },
};

const negotiation = adapter.negotiate(request);
if (!negotiation.supported) {
  throw new Error(negotiation.reasons.map((reason) => reason.message).join(' '));
}

const result = await adapter.execute(request);
```

### Honest usage guidance

Use this adapter when you want:
- a hosted API backend
- one bounded no-tool turn
- normalized `ExecutionResult` output through the same execution seam as other backends

Do **not** treat it as a replacement for:
- the local CLI harness BYOH path
- Relay-native collaboration
- future tool-capable hosted execution work

## Local command execution adapter

The harness package also exposes a reusable `LocalCommandExecutionAdapter` for BYOH/local
CLI execution. It is product-neutral: products keep assistant identity, policy, memory, and
turn-context assembly, while the adapter owns only local process invocation and result
normalization.

Use it when a local harness can be represented as:
- a command to spawn
- an argv builder from `ExecutionRequest`
- an output parser into normalized assistant output
- declared `ExecutionCapabilities`

```ts
import {
  LocalCommandExecutionAdapter,
  type ExecutionRequest,
} from '@agent-assistant/harness';

const adapter = new LocalCommandExecutionAdapter({
  backendId: 'my-local-harness',
  command: 'my-harness',
  capabilities: {
    toolUse: 'adapter-mediated',
    structuredToolCalls: true,
    continuationSupport: 'none',
    approvalInterrupts: 'none',
    traceDepth: 'minimal',
    attachments: false,
  },
  buildArgs(request: ExecutionRequest) {
    return ['--json', '--prompt', request.message.text];
  },
  parseOutput(stdout) {
    const parsed = JSON.parse(stdout) as { text?: string };
    return parsed.text ? { text: parsed.text } : null;
  },
});
```

`ClaudeCodeExecutionAdapter` is now a preset over this same local-command primitive. That keeps
Claude Code support intact while allowing other local harnesses to use the same
`ExecutionAdapter` contract.

## Agent Relay execution adapter

For long-lived local harnesses, `AgentRelayExecutionAdapter` uses Agent Relay as the local
control plane. It publishes a typed execution request to a Relay worker and waits for a typed
execution result on the same thread.

```ts
import {
  AgentRelayExecutionAdapter,
} from '@agent-assistant/harness';

const adapter = new AgentRelayExecutionAdapter({
  cwd: process.cwd(),
  channelId: 'nightcto-local-byoh',
  workerName: 'nightcto-local-harness',
  orchestratorName: 'nightcto-local-chat',
});
```

The request message body is JSON with type `agent-assistant.execution-request.v1`.
Workers reply with JSON type `agent-assistant.execution-result.v1` and an `executionResult`
that follows the normal `ExecutionResult` contract. Successful turns should use
`executionResult.status: "completed"` and put the assistant answer in
`executionResult.output.text`. The adapter also tolerates common local-worker shorthands
such as `status: "ok"` plus `answer` and normalizes them into the same `ExecutionResult`
shape. This keeps Claude Code, Codex, OpenCode, or a custom local worker behind Relay
instead of baking provider-specific CLI argv into the product.

### spawnWorker vs worker-bridge

`AgentRelayExecutionAdapter`'s `spawnWorker.enabled` spawns a bare CLI as a
Relay agent and expects it to respond protocol-compliant messages on its own.
That only works if the spawned CLI has MCP tools wired to send typed Relay
messages — not the default for most CLIs. Leaving `spawnWorker.enabled`
false and running a **worker-bridge** process separately (see next section)
is the recommended shape; the bridge does the protocol translation so the
CLI is just a prompt-in, text-out subprocess.

## Worker-bridge (`@agent-assistant/harness/worker-bridge`)

Dual of the adapter. Listens for `agent-assistant.execution-request.v1`
messages on a Relay channel, invokes a non-interactive CLI session
(`claude -p`, `codex exec`, `opencode run`, `gemini -p`, or a bash stub for
testing), captures stdout, and replies with a correctly-shaped
`agent-assistant.execution-result.v1` message.

```ts
import { RelayAdapter } from '@agent-relay/sdk';
import {
  createClaudeCliRunner,
  createRelayWorkerBridge,
} from '@agent-assistant/harness/worker-bridge';

const relay = new RelayAdapter({ cwd: process.cwd(), channels: ['specialists'] });
await relay.start();

const bridge = await createRelayWorkerBridge({
  relay,
  channelId: 'specialists',
  workerName: 'specialist-worker',
  runner: createClaudeCliRunner(),
  timeoutMs: 120_000,
});

// ... later
bridge.dispose();
await relay.shutdown();
```

Runners provided: `createClaudeCliRunner`, `createCodexCliRunner`,
`createOpenCodeCliRunner`, `createGeminiCliRunner`, and
`createBashCliRunner` (for token-free testing). Each takes an optional
`{ command, spawnFn }` config for overriding the executable or injecting a
mock `child_process.spawn`.

`CliRunner` is a minimal interface (`{ id, run(input) }`) so you can plug in
your own CLI or embedded function.

The adapter + bridge are intentionally separate processes in production:
the adapter lives wherever your orchestrator runs, the bridge lives on the
machine/container that should actually invoke the CLI. Cross-process broker
discovery happens via `{cwd}/.agent-relay/connection.json`.

`packages/webhook-runtime/examples/byoh-worker.ts` is a thin wrapper over
this API that exposes `--cli`, `--channel`, `--worker-name`, `--model`, and
`--timeout-ms` flags for the two-terminal local-experimentation flow.

## Public API

```ts
import {
  AgentRelayExecutionAdapter,
  HarnessConfigError,
  LocalCommandExecutionAdapter,
  OpenRouterExecutionAdapter,
  createAgentRelayExecutionAdapter,
  createHarness,
  createLocalCommandAdapter,
  createOpenRouterAdapter,
  type ExecutionAdapter,
  type ExecutionRequest,
  type ExecutionResult,
  type HarnessConfig,
  type HarnessContinuation,
  type HarnessModelAdapter,
  type HarnessResult,
  type HarnessRuntime,
  type HarnessToolRegistry,
  type HarnessTraceSink,
  type HarnessTurnInput,
} from '@agent-assistant/harness';
```

## Runtime Behavior Notes

- v1 tool execution is sequential by default
- approvals are an adapter seam; the package does not own policy
- bounded stops return `deferred` results with continuation payloads
- invalid model outputs are tolerated only within configured limits
- runtime/model/tool failures are surfaced as structured results rather than hidden behind fake completion

## Development

From the package directory:

```bash
npm test
npm run build
```

Current package validation includes a non-trivial test suite covering:
- final answer execution
- sequential tool loops
- clarification and approval continuations
- invalid output recovery and failure bounds
- retryable vs unrecoverable tool errors
- deferred outcomes for iteration and budget ceilings
- runtime error surfacing
- focused OpenRouter adapter coverage for bounded no-tool hosted execution

HARNESS_PACKAGE_IMPLEMENTED
