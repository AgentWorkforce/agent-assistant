import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  HarnessToolCall,
  HarnessToolDefinition,
  HarnessToolExecutionContext,
  HarnessToolResult,
} from '../types.js';
import type {
  CreateMcpToolRegistryOptions,
  McpProjectedTool,
  McpServerConfig,
  McpServerStatus,
  McpToolRegistry,
} from './types.js';

type JsonRpcResponse = {
  jsonrpc?: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code?: string | number; message?: string; data?: unknown };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    requiresApproval?: boolean;
    destructiveHint?: boolean;
    readOnlyHint?: boolean;
  };
};

type ConnectionState = {
  config: McpServerConfig;
  state: McpServerStatus['state'];
  tools: McpProjectedTool[];
  lastError?: string;
  stdio?: StdioJsonRpcClient;
};

class StdioJsonRpcClient {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', () => this.rejectAll(new Error('MCP stdio server exited.')));
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  close(): void {
    this.child.kill();
    this.rejectAll(new Error('MCP stdio client closed.'));
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }

      const raw = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (raw.length === 0) {
        continue;
      }

      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(raw) as JsonRpcResponse;
      } catch {
        continue;
      }

      if (typeof parsed.id !== 'number') {
        continue;
      }

      const pending = this.pending.get(parsed.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(parsed.id);
      if (parsed.error) {
        pending.reject(jsonRpcError(parsed.error));
      } else {
        pending.resolve(parsed.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonRpcError(error: NonNullable<JsonRpcResponse['error']>): Error {
  const message = error.message ?? `MCP JSON-RPC error ${String(error.code ?? 'unknown')}`;
  const wrapped = new Error(message);
  Object.assign(wrapped, { mcpErrorCode: error.code, mcpErrorData: error.data });
  return wrapped;
}

function readTools(value: unknown): McpTool[] {
  const container = isRecord(value) ? value : {};
  const rawTools = Array.isArray(container.tools) ? container.tools : Array.isArray(value) ? value : [];
  const tools: McpTool[] = [];

  for (const raw of rawTools) {
    if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.length === 0) {
      continue;
    }

    tools.push({
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : undefined,
      annotations: isRecord(raw.annotations)
        ? {
            requiresApproval:
              typeof raw.annotations.requiresApproval === 'boolean'
                ? raw.annotations.requiresApproval
                : undefined,
            destructiveHint:
              typeof raw.annotations.destructiveHint === 'boolean'
                ? raw.annotations.destructiveHint
                : undefined,
            readOnlyHint:
              typeof raw.annotations.readOnlyHint === 'boolean'
                ? raw.annotations.readOnlyHint
                : undefined,
          }
        : undefined,
    });
  }

  return tools;
}

function textFromCallResult(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return undefined;
  }

  const parts = result.content
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .map((part) => (typeof part.text === 'string' ? part.text : undefined))
    .filter((text): text is string => Boolean(text));

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function structuredFromCallResult(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  return isRecord(result.structuredContent) ? result.structuredContent : undefined;
}

function readMcpErrorCode(error: unknown): string | number | undefined {
  return isRecord(error) ? error.mcpErrorCode as string | number | undefined : undefined;
}

class McpRegistry implements McpToolRegistry {
  private readonly states: ConnectionState[];
  private readonly toolsByName = new Map<string, McpProjectedTool>();
  private readonly toolNameStrategy: 'prefix' | 'flat';
  private readonly defaultRequiresApproval: boolean | undefined;

  constructor(options: CreateMcpToolRegistryOptions) {
    this.states = options.servers.map((config) => ({
      config,
      state: 'disconnected',
      tools: [],
    }));
    this.toolNameStrategy = options.toolNameStrategy ?? 'prefix';
    this.defaultRequiresApproval = options.defaultRequiresApproval;
  }

  async connect(): Promise<void> {
    this.toolsByName.clear();
    await Promise.all(this.states.map((state) => this.connectOne(state)));
  }

  async disconnect(): Promise<void> {
    for (const state of this.states) {
      state.stdio?.close();
      state.stdio = undefined;
      state.state = 'disconnected';
      state.lastError = undefined;
    }
  }

  status(): McpServerStatus[] {
    return this.states.map((state) => ({
      name: state.config.name,
      state: state.state,
      toolCount: state.tools.length,
      lastError: state.lastError,
    }));
  }

  async listAvailable(): Promise<HarnessToolDefinition[]> {
    if (this.states.some((state) => state.state === 'disconnected')) {
      await this.connect();
    }

    return [...this.toolsByName.values()].map((tool) => tool.definition);
  }

  async execute(
    call: HarnessToolCall,
    _context: HarnessToolExecutionContext,
  ): Promise<HarnessToolResult> {
    if (!this.toolsByName.has(call.name) && this.states.every((state) => state.state === 'disconnected')) {
      await this.connect();
    }

    const projected = this.toolsByName.get(call.name);
    if (!projected) {
      return {
        callId: call.id,
        toolName: call.name,
        status: 'error',
        error: {
          code: 'mcp_tool_not_found',
          message: `MCP tool "${call.name}" is not available.`,
          retryable: false,
        },
      };
    }

    const state = this.states.find((candidate) => candidate.config.name === projected.serverName);
    if (!state || state.state !== 'connected') {
      return transportError(call, call.name, `MCP server "${projected.serverName}" is not connected.`);
    }

    try {
      const result = await this.callTool(state, projected.mcpToolName, call.input);
      if (isRecord(result) && result.isError === true) {
        return {
          callId: call.id,
          toolName: call.name,
          status: 'error',
          output: textFromCallResult(result),
          structuredOutput: structuredFromCallResult(result),
          error: {
            code: 'mcp_tool_error',
            message: textFromCallResult(result) ?? 'MCP tool returned an error result.',
            retryable: false,
            metadata: { serverName: projected.serverName, mcpToolName: projected.mcpToolName },
          },
        };
      }

      return {
        callId: call.id,
        toolName: call.name,
        status: 'success',
        output: textFromCallResult(result),
        structuredOutput: structuredFromCallResult(result),
        metadata: { serverName: projected.serverName, mcpToolName: projected.mcpToolName },
      };
    } catch (error) {
      const mcpErrorCode = readMcpErrorCode(error);
      if (mcpErrorCode !== undefined) {
        return {
          callId: call.id,
          toolName: call.name,
          status: 'error',
          error: {
            code: 'mcp_tool_error',
            message: error instanceof Error ? error.message : 'MCP tool call failed.',
            retryable: false,
            metadata: { serverName: projected.serverName, mcpToolName: projected.mcpToolName, mcpErrorCode },
          },
        };
      }

      return transportError(
        call,
        call.name,
        error instanceof Error ? error.message : 'MCP transport failed.',
      );
    }
  }

  private async connectOne(state: ConnectionState): Promise<void> {
    state.state = 'connecting';
    state.lastError = undefined;
    try {
      if (state.config.transport.kind === 'stdio') {
        await this.connectStdio(state);
      } else {
        await this.connectHttp(state);
      }
      state.state = 'connected';
      for (const tool of state.tools) {
        this.toolsByName.set(tool.exposedName, tool);
      }
    } catch (error) {
      state.state = 'failed';
      state.tools = [];
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async connectHttp(state: ConnectionState): Promise<void> {
    await this.httpRequest(state, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: '@agent-assistant/harness', version: '0.5-scaffold' },
    });
    await this.httpRequest(state, 'notifications/initialized');
    const result = await this.httpRequest(state, 'tools/list');
    state.tools = this.projectTools(state.config, readTools(result));
  }

  private async connectStdio(state: ConnectionState): Promise<void> {
    const transport = state.config.transport;
    if (transport.kind !== 'stdio') {
      throw new Error('MCP server is not configured for stdio.');
    }
    const child = spawn(transport.command, transport.args ?? [], {
      cwd: transport.cwd,
      env: { ...process.env, ...(transport.env ?? {}) },
      stdio: 'pipe',
    });
    const client = new StdioJsonRpcClient(child);
    state.stdio = client;
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: '@agent-assistant/harness', version: '0.5-scaffold' },
    });
    client.notify('notifications/initialized');
    const result = await client.request('tools/list');
    state.tools = this.projectTools(state.config, readTools(result));
  }

  private async callTool(
    state: ConnectionState,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (state.config.transport.kind === 'stdio') {
      if (!state.stdio) {
        throw new Error('MCP stdio server is not connected.');
      }
      return state.stdio.request('tools/call', { name, arguments: args });
    }

    return this.httpRequest(state, 'tools/call', { name, arguments: args });
  }

  private async httpRequest(
    state: ConnectionState,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (state.config.transport.kind !== 'http') {
      throw new Error('MCP server is not configured for HTTP.');
    }

    const fetchImpl =
      state.config.transport.fetchImpl ??
      ((input, init) => globalThis.fetch(input, init));
    const response = await fetchImpl(state.config.transport.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.config.transport.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${state.config.name}:${Date.now()}:${Math.random()}`,
        method,
        params,
      }),
    });
    const body = (await response.json()) as JsonRpcResponse;

    if (!response.ok) {
      throw new Error(`MCP HTTP request failed with status ${response.status}.`);
    }

    if (body.error) {
      throw jsonRpcError(body.error);
    }

    return body.result;
  }

  private projectTools(config: McpServerConfig, tools: McpTool[]): McpProjectedTool[] {
    const projected: McpProjectedTool[] = [];
    for (const tool of tools) {
      const exposedName =
        this.toolNameStrategy === 'prefix'
          ? `${config.name}__${tool.name}`
          : tool.name;

      if (
        config.allowedToolNames &&
        !config.allowedToolNames.includes(tool.name) &&
        !config.allowedToolNames.includes(exposedName)
      ) {
        continue;
      }

      projected.push({
        serverName: config.name,
        mcpToolName: tool.name,
        exposedName,
        definition: {
          name: exposedName,
          description: tool.description ?? `MCP tool ${tool.name} from ${config.name}`,
          inputSchema: tool.inputSchema,
          requiresApproval:
            tool.annotations?.requiresApproval ??
            tool.annotations?.destructiveHint ??
            this.defaultRequiresApproval,
          metadata: {
            ...(config.metadata ?? {}),
            serverName: config.name,
            mcpToolName: tool.name,
            mcpTransport: config.transport.kind,
            ...(tool.annotations ? { mcpAnnotations: tool.annotations } : {}),
          },
        },
      });
    }
    return projected;
  }
}

function transportError(
  call: HarnessToolCall,
  toolName: string,
  message: string,
): HarnessToolResult {
  return {
    callId: call.id,
    toolName,
    status: 'error',
    error: {
      code: 'mcp_transport_error',
      message,
      retryable: true,
    },
  };
}

export function createMcpToolRegistry(options: CreateMcpToolRegistryOptions): McpToolRegistry {
  return new McpRegistry(options);
}
