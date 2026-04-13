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

## Public API

```ts
import {
  HarnessConfigError,
  createHarness,
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

HARNESS_PACKAGE_IMPLEMENTED
