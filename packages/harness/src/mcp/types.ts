import type {
  HarnessToolDefinition,
  HarnessToolRegistry,
} from '../types.js';

export interface McpServerConfig {
  name: string;
  transport: McpStdioTransport | McpHttpTransport;
  /** Optional allow-list. If unset, all server-provided tools are exposed. */
  allowedToolNames?: string[];
  /** Optional metadata merged into each projected HarnessToolDefinition.metadata. */
  metadata?: Record<string, unknown>;
}

export interface McpStdioTransport {
  kind: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpTransport {
  kind: 'http';
  url: string;
  headers?: Record<string, string>;
  /** Optional fetch impl; defaults to a call-time globalThis.fetch lambda. */
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface CreateMcpToolRegistryOptions {
  servers: McpServerConfig[];
  /** Default `requiresApproval` when MCP server does not specify. */
  defaultRequiresApproval?: boolean;
  /** How to label tool name collisions across servers. Default: `${serverName}__${toolName}`. */
  toolNameStrategy?: 'prefix' | 'flat';
}

export interface McpToolRegistryControl {
  /** Connect (or reconnect) to all configured servers. Idempotent. */
  connect(): Promise<void>;
  /** Disconnect from all servers. Subsequent execute calls fail until connect/listAvailable runs. */
  disconnect(): Promise<void>;
  /** Server connection statuses for health surfaces. */
  status(): McpServerStatus[];
}

export interface McpServerStatus {
  name: string;
  state: 'disconnected' | 'connecting' | 'connected' | 'failed';
  toolCount?: number;
  lastError?: string;
}

export type McpToolRegistry = HarnessToolRegistry & McpToolRegistryControl;

export interface McpProjectedTool {
  serverName: string;
  mcpToolName: string;
  exposedName: string;
  definition: HarnessToolDefinition;
}
