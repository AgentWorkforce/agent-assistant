import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels } from '@agent-relay/config';

async function runWorkflow() {
  const result = await workflow('build-harness-bash-tool-registry')
    .description(
      'Implement BashToolRegistry (HarnessToolRegistry exposing one allowlist-gated bash tool) plus its vitest suite. Leaves changes uncommitted; integration workflow handles wiring, version bump, and PR.',
    )
    .pattern('dag')
    .channel('wf-build-bash-tool-registry')
    .maxConcurrency(2)
    .timeout(1_800_000)

    .agent('impl', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'worker',
      role: 'Implements the Bash tool registry and its vitest suite. Reads contract types from packages/harness/src/types.ts.',
      retries: 2,
    })

    .step('read-context', {
      type: 'deterministic',
      command: [
        'echo "===== HARNESS TYPES ====="',
        'cat packages/harness/src/types.ts',
        'echo "" && echo "===== HARNESS RUNTIME (tool execution loop) ====="',
        'cat packages/harness/src/harness.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tool-registry', {
      agent: 'impl',
      dependsOn: ['read-context'],
      task: `Create file: packages/harness/src/tools/bash-tool-registry.ts (create the tools/ directory if needed).

Implement BashToolRegistry — a HarnessToolRegistry that exposes a single 'bash' tool to the model with a first-token allowlist.

Contract (from packages/harness/src/types.ts):

  interface HarnessToolRegistry {
    listAvailable(input: HarnessToolAvailabilityInput): Promise<HarnessToolDefinition[]>;
    execute(call: HarnessToolCall, context: HarnessToolExecutionContext): Promise<HarnessToolResult>;
  }

  interface HarnessToolDefinition { name; description; inputSchema?; requiresApproval? }
  interface HarnessToolCall { id; name; input: Record<string,unknown> }
  interface HarnessToolResult {
    callId; toolName;
    status: 'success' | 'error';
    output?: string;
    error?: { code: string; message: string; retryable?: boolean };
  }

Required exports:
  - export interface BashToolConfig {
      allowedCommands: string[];      // first-token allowlist, e.g. ['sage-vfs']
      cwd?: string;
      env?: Record<string, string>;   // merged onto process.env
      timeoutMs?: number;             // default 30_000
      maxOutputBytes?: number;        // default 65_536
      spawnImpl?: typeof import('node:child_process').spawn;
    }
  - export class BashToolRegistry implements HarnessToolRegistry
  - export function createBashToolRegistry(config: BashToolConfig): HarnessToolRegistry

listAvailable returns exactly one tool:
  {
    name: 'bash',
    description: \`Execute a shell command. Only the following first-token commands are permitted: \${allowedCommands.join(', ')}. Provide the full command line as input.command.\`,
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Full command line to execute' } },
      required: ['command'],
    },
  }

execute behavior:
  - call.name !== 'bash' → error code 'unknown_tool'
  - typeof input.command !== 'string' → error code 'invalid_input'
  - first token (after trim, split on whitespace) not in allowedCommands → error code 'command_not_allowed', message names the rejected token + allowlist
  - Spawn with shell:true, cwd, env merged with process.env. Use spawnImpl ?? spawn from 'node:child_process'.
  - Capture combined stdout+stderr up to maxOutputBytes; truncate with marker '\\n[output truncated to N bytes]'.
  - Timeout: setTimeout → child.kill('SIGKILL') → error code 'timeout', retryable:true
  - Exit 0 → status 'success', output = captured
  - Non-zero exit → error code 'nonzero_exit', message includes exit code and tail of output, retryable:false
  - Spawn 'error' event → error code 'spawn_error', message from error
  - All results carry callId: call.id, toolName: 'bash'

Use ESM. import { spawn } from 'node:child_process' (only for default; spawnImpl override takes precedence).

Do NOT modify any other files. Write to disk. End with BASH_TOOL_REGISTRY_IMPLEMENTED.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/tools/bash-tool-registry.ts',
      },
    })

    .step('write-test', {
      agent: 'impl',
      dependsOn: ['implement-tool-registry'],
      task: `Create file: packages/harness/src/tools/bash-tool-registry.test.ts

Use vitest. Inject spawnImpl (vi.fn returning a fake ChildProcess: EventEmitter with stdout, stderr (also EventEmitters), kill()).

Required cases:
  1. listAvailable returns exactly one tool with correct schema
  2. unknown tool name → 'unknown_tool'
  3. non-string command → 'invalid_input'
  4. command first-token not in allowlist → 'command_not_allowed', message includes rejected token
  5. success path: emit stdout 'hello\\n', close 0 → status 'success', output contains 'hello'
  6. non-zero exit: emit stderr 'oops', close 2 → 'nonzero_exit', message includes '2'
  7. timeout: never close, timeoutMs 50 → 'timeout', kill('SIGKILL') was called
  8. output truncation: large stdout > maxOutputBytes → output bounded, contains truncation marker
  9. allowlist names appear in tool description
  10. spawn 'error' event → 'spawn_error'

Use Node EventEmitter to build fakes. End with BASH_TOOL_REGISTRY_TEST_WRITTEN.`,
      verification: {
        type: 'file_exists',
        value: 'packages/harness/src/tools/bash-tool-registry.test.ts',
      },
    })

    .step('run-tests-first-pass', {
      type: 'deterministic',
      dependsOn: ['write-test'],
      command:
        'npx vitest run packages/harness/src/tools/bash-tool-registry.test.ts 2>&1 | tail -80',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-test-failures', {
      agent: 'impl',
      dependsOn: ['run-tests-first-pass'],
      task: `Fix failures until all BashToolRegistry tests pass.

Test output:
{{steps.run-tests-first-pass.output}}

If green, do nothing.
Otherwise: read test + source, fix in source (unless test is wrong), re-run:
  npx vitest run packages/harness/src/tools/bash-tool-registry.test.ts
Iterate. End with TESTS_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('run-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-test-failures'],
      command:
        'npx vitest run packages/harness/src/tools/bash-tool-registry.test.ts 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .step('build-check', {
      type: 'deterministic',
      dependsOn: ['run-tests-final'],
      command: 'npm run build -w @agent-assistant/harness 2>&1 | tail -40; echo "EXIT: $?"',
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-build-errors', {
      agent: 'impl',
      dependsOn: ['build-check'],
      task: `Fix any tsc errors caused by this change.

Build output:
{{steps.build-check.output}}

If exit 0, do nothing. Else fix in source, re-run:
  npm run build -w @agent-assistant/harness
End with BUILD_FIXED.`,
      verification: { type: 'exit_code' },
    })

    .step('build-final', {
      type: 'deterministic',
      dependsOn: ['fix-build-errors'],
      command: 'npm run build -w @agent-assistant/harness 2>&1',
      captureOutput: true,
      failOnError: true,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 5_000 })
    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

runWorkflow().catch((error) => {
  console.error(error);
  process.exit(1);
});
