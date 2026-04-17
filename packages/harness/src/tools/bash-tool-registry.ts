import { spawn as nodeSpawn } from 'node:child_process';
import type {
  HarnessToolRegistry,
  HarnessToolAvailabilityInput,
  HarnessToolDefinition,
  HarnessToolCall,
  HarnessToolExecutionContext,
  HarnessToolResult,
} from '../types.js';

export interface BashToolConfig {
  allowedCommands: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  spawnImpl?: typeof nodeSpawn;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536;

export class BashToolRegistry implements HarnessToolRegistry {
  private readonly config: Required<Omit<BashToolConfig, 'cwd' | 'env'>> &
    Pick<BashToolConfig, 'cwd' | 'env'>;

  constructor(config: BashToolConfig) {
    this.config = {
      allowedCommands: config.allowedCommands,
      cwd: config.cwd,
      env: config.env,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      spawnImpl: config.spawnImpl ?? nodeSpawn,
    };
  }

  async listAvailable(_input: HarnessToolAvailabilityInput): Promise<HarnessToolDefinition[]> {
    return [
      {
        name: 'bash',
        description: `Execute a shell command. Only the following first-token commands are permitted: ${this.config.allowedCommands.join(', ')}. Provide the full command line as input.command.`,
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Full command line to execute' },
          },
          required: ['command'],
        },
      },
    ];
  }

  async execute(
    call: HarnessToolCall,
    _context: HarnessToolExecutionContext,
  ): Promise<HarnessToolResult> {
    const base = { callId: call.id, toolName: 'bash' };

    if (call.name !== 'bash') {
      return {
        ...base,
        status: 'error',
        error: { code: 'unknown_tool', message: `Unknown tool: ${call.name}` },
      };
    }

    const { command } = call.input;
    if (typeof command !== 'string') {
      return {
        ...base,
        status: 'error',
        error: { code: 'invalid_input', message: 'input.command must be a string' },
      };
    }

    const firstToken = command.trim().split(/\s+/)[0];
    if (!firstToken || !this.config.allowedCommands.includes(firstToken)) {
      return {
        ...base,
        status: 'error',
        error: {
          code: 'command_not_allowed',
          message: `Command '${firstToken}' is not allowed. Permitted first-token commands: ${this.config.allowedCommands.join(', ')}`,
        },
      };
    }

    return new Promise<HarnessToolResult>((resolve) => {
      const spawnFn = this.config.spawnImpl;
      const mergedEnv = { ...process.env, ...(this.config.env ?? {}) };

      const child = spawnFn(command, {
        shell: true,
        cwd: this.config.cwd,
        env: mergedEnv,
      });

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;
      const maxBytes = this.config.maxOutputBytes;

      const onData = (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (truncated) return;
        const remaining = maxBytes - totalBytes;
        if (buf.length <= remaining) {
          chunks.push(buf);
          totalBytes += buf.length;
        } else {
          chunks.push(buf.subarray(0, remaining));
          totalBytes = maxBytes;
          truncated = true;
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      const getOutput = (): string => {
        const raw = Buffer.concat(chunks).toString('utf8');
        return truncated ? `${raw}\n[output truncated to ${maxBytes} bytes]` : raw;
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({
          ...base,
          status: 'error',
          error: {
            code: 'timeout',
            message: `Command timed out after ${this.config.timeoutMs}ms`,
            retryable: true,
          },
        });
      }, this.config.timeoutMs);

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({
          ...base,
          status: 'error',
          error: { code: 'spawn_error', message: err.message },
        });
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const output = getOutput();
        if (code === 0) {
          resolve({ ...base, status: 'success', output });
        } else {
          const tail = output.slice(-500);
          resolve({
            ...base,
            status: 'error',
            error: {
              code: 'nonzero_exit',
              message: `Command exited with code ${code}. Output tail: ${tail}`,
              retryable: false,
            },
          });
        }
      });
    });
  }
}

export function createBashToolRegistry(config: BashToolConfig): HarnessToolRegistry {
  return new BashToolRegistry(config);
}
