# Ricky Harness v0.5 Implementation Notes

This slice implements the additive v0.5 harness surfaces for streaming contracts, cancellation, and MCP registry scaffolding.

Streaming changes are contract-only in this slice. `ExecutionAdapter` now accepts optional `executeStreaming()`, `ExecutionRequirements.streaming` can be `forbidden`, `preferred`, or `required`, `ExecutionCapabilities.streaming` can advertise `none`, `native`, or `adapter-mediated`, and `ExecutionStreamEvent` is exported through the existing adapter/root barrel path. Existing adapters continue to work because the new method and capability field are optional; negotiation treats absent streaming support as `none`.

Cancellation is now plumbed through `HarnessTurnInput`, `HarnessModelInput`, `HarnessToolExecutionContext`, `HarnessApprovalRequestInput`, and `ExecutionRequest`. The harness checks abort state after `turn_started`, at each iteration boundary, after model calls, after approval preparation, and after each tool call. Cancelled turns return `outcome: failed` with `stopReason: cancelled` and still emit the final `turn_finished` trace exactly once. OpenRouter model and execution adapters forward request signals into their fetch call through a call-time `globalThis.fetch` lambda path.

MCP support is scaffolded behind the new `@agent-assistant/harness/mcp` subpath. The default root barrel does not export MCP runtime code, preserving worker bundle compatibility for existing imports. `createMcpToolRegistry` implements `HarnessToolRegistry & McpToolRegistryControl`, supports HTTP and stdio JSON-RPC transports, projects MCP tool metadata into `HarnessToolDefinition`, prefixes tool names by default, and maps transport and server-reported tool errors into `HarnessToolResult`.

MCP execution reconnects lazily only when a tool has not yet been discovered. Once a turn has discovered tools, disconnecting the backing server causes subsequent `execute` calls for that known tool to surface a retryable `mcp_transport_error` instead of silently reconnecting mid-turn.

Relevant tests cover harness cancellation invariants, adapter signal forwarding, streaming negotiation, HTTP MCP with call-time `globalThis.fetch`, default tool-name prefixing, MCP error mapping, disconnected MCP execution, and stdio fixture execution.

V0_5_SLICE_IMPLEMENTED
