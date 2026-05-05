import { describe, expect, it, vi, afterEach } from 'vitest';

import { createMcpToolRegistry } from './index.js';

function makeMcpResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'response-1', result }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createMcpToolRegistry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('connects to an HTTP MCP server, lists prefixed tools, and executes a tool', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params?: Record<string, unknown> };
      if (body.method === 'tools/list') {
        return makeMcpResponse({
          tools: [
            {
              name: 'search',
              description: 'Search docs',
              inputSchema: { type: 'object' },
              annotations: { requiresApproval: true },
            },
          ],
        });
      }
      if (body.method === 'tools/call') {
        return makeMcpResponse({
          content: [{ type: 'text', text: `searched:${JSON.stringify(body.params?.arguments)}` }],
          structuredContent: { ok: true },
        });
      }
      return makeMcpResponse({});
    });

    const registry = createMcpToolRegistry({
      servers: [
        {
          name: 'docs',
          transport: { kind: 'http', url: 'https://mcp.example.test', fetchImpl },
          metadata: { owner: 'test' },
        },
      ],
    });

    const tools = await registry.listAvailable({
      assistantId: 'a1',
      turnId: 't1',
    });
    const result = await registry.execute(
      { id: 'call-1', name: 'docs__search', input: { query: 'harness' } },
      { assistantId: 'a1', turnId: 't1', iteration: 1, toolCallIndex: 0 },
    );

    expect(tools).toEqual([
      expect.objectContaining({
        name: 'docs__search',
        description: 'Search docs',
        inputSchema: { type: 'object' },
        requiresApproval: true,
        metadata: expect.objectContaining({
          owner: 'test',
          serverName: 'docs',
          mcpToolName: 'search',
          mcpTransport: 'http',
        }),
      }),
    ]);
    expect(result).toMatchObject({
      callId: 'call-1',
      toolName: 'docs__search',
      status: 'success',
      output: 'searched:{"query":"harness"}',
      structuredOutput: { ok: true },
    });
    expect(registry.status()).toEqual([
      { name: 'docs', state: 'connected', toolCount: 1, lastError: undefined },
    ]);
  });

  it('uses call-time globalThis.fetch for HTTP transport when fetchImpl is omitted', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return body.method === 'tools/list' ? makeMcpResponse({ tools: [] }) : makeMcpResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const registry = createMcpToolRegistry({
      servers: [{ name: 'global', transport: { kind: 'http', url: 'https://mcp.example.test' } }],
    });

    await registry.connect();

    expect(fetchMock).toHaveBeenCalled();
    expect(registry.status()[0]).toMatchObject({ name: 'global', state: 'connected' });
  });

  it('prefixes same-named tools from multiple servers by default', async () => {
    const fetchImpl = vi.fn(async () =>
      makeMcpResponse({ tools: [{ name: 'lookup', description: 'Lookup' }] }),
    );
    const registry = createMcpToolRegistry({
      servers: [
        { name: 'one', transport: { kind: 'http', url: 'https://one.example.test', fetchImpl } },
        { name: 'two', transport: { kind: 'http', url: 'https://two.example.test', fetchImpl } },
      ],
    });

    const tools = await registry.listAvailable({ assistantId: 'a1', turnId: 't1' });

    expect(tools.map((tool) => tool.name).sort()).toEqual(['one__lookup', 'two__lookup']);
  });

  it('maps MCP JSON-RPC errors to non-retryable tool errors with the original code', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'tools/list') {
        return makeMcpResponse({ tools: [{ name: 'fail', description: 'Fail' }] });
      }
      if (body.method === 'tools/call') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'response-1',
            error: { code: 'bad_input', message: 'Bad input' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return makeMcpResponse({});
    });
    const registry = createMcpToolRegistry({
      servers: [{ name: 'errors', transport: { kind: 'http', url: 'https://mcp.example.test', fetchImpl } }],
    });

    const result = await registry.execute(
      { id: 'call-1', name: 'errors__fail', input: {} },
      { assistantId: 'a1', turnId: 't1', iteration: 1, toolCallIndex: 0 },
    );

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'mcp_tool_error',
        message: 'Bad input',
        retryable: false,
        metadata: { mcpErrorCode: 'bad_input' },
      },
    });
  });

  it('surfaces a retryable transport error when disconnected after tool discovery', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return body.method === 'tools/list'
        ? makeMcpResponse({ tools: [{ name: 'lookup', description: 'Lookup' }] })
        : makeMcpResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    const registry = createMcpToolRegistry({
      servers: [{ name: 'midturn', transport: { kind: 'http', url: 'https://mcp.example.test', fetchImpl } }],
    });

    await registry.listAvailable({ assistantId: 'a1', turnId: 't1' });
    await registry.disconnect();
    const result = await registry.execute(
      { id: 'call-1', name: 'midturn__lookup', input: {} },
      { assistantId: 'a1', turnId: 't1', iteration: 1, toolCallIndex: 0 },
    );

    expect(result).toMatchObject({
      callId: 'call-1',
      toolName: 'midturn__lookup',
      status: 'error',
      error: {
        code: 'mcp_transport_error',
        retryable: true,
      },
    });
  });

  it('connects to a stdio MCP fixture and executes a tool', async () => {
    const fixture = `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        if (msg.method === 'notifications/initialized') return;
        let result = {};
        if (msg.method === 'tools/list') {
          result = { tools: [{ name: 'echo', description: 'Echo input' }] };
        }
        if (msg.method === 'tools/call') {
          result = { content: [{ type: 'text', text: 'echo:' + msg.params.arguments.text }] };
        }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
      });
    `;
    const registry = createMcpToolRegistry({
      servers: [
        {
          name: 'stdio',
          transport: { kind: 'stdio', command: process.execPath, args: ['-e', fixture] },
        },
      ],
    });

    try {
      const tools = await registry.listAvailable({ assistantId: 'a1', turnId: 't1' });
      const result = await registry.execute(
        { id: 'call-1', name: 'stdio__echo', input: { text: 'hello' } },
        { assistantId: 'a1', turnId: 't1', iteration: 1, toolCallIndex: 0 },
      );

      expect(tools.map((tool) => tool.name)).toEqual(['stdio__echo']);
      expect(result).toMatchObject({ status: 'success', output: 'echo:hello' });
    } finally {
      await registry.disconnect();
    }
  });
});
