/**
 * Dispatch envelope contracts from canonical spec section 7.2.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#72-dispatch-envelope
 */
export interface DispatchEnvelope<TPayload = unknown> {
  type: string;
  personaId: string;
  workspaceId: string;
  deploymentId: string;
  occurredAt: string;
  envelope: EventEnvelope<TPayload>;
  integrations?: Record<string, IntegrationAccess>;
  borrowEndpoint?: string;
  callbackEndpoint?: string;
}

/**
 * Event payload wrapper from canonical spec section 7.2.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#72-dispatch-envelope
 */
export interface EventEnvelope<TPayload = unknown> {
  id: string;
  name?: string;
  payload: TPayload;
}

/**
 * Integration access metadata from canonical spec section 7.2.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#72-dispatch-envelope
 */
export interface IntegrationAccess {
  provider: string;
  connectionId: string;
  scopes?: string[];
}

/**
 * Dispatch response and async callback contracts from canonical spec section 7.5.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback
 */
export type DispatchResponse =
  | { kind: "done"; delivery: DeliveryHint[]; log?: LogEntry[] }
  | { kind: "borrow-sandbox"; reason: string; task: SandboxTask; afterTask?: AfterTaskHook }
  | { kind: "async"; estimatedDurationSeconds: number; callback: string }
  | { kind: "error"; retryable: boolean; code: string; message: string };

/**
 * Delivery hints from canonical spec section 7.5.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback
 */
export interface DeliveryHint {
  kind: string;
  target?: string;
  text?: string;
  meta?: Record<string, unknown>;
}

/**
 * Structured dispatch logs from canonical spec section 7.5.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback
 */
export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * Sandbox work request from canonical spec section 7.5.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback
 */
export interface SandboxTask {
  command: string;
  env?: Record<string, string>;
}

/**
 * Post-sandbox callback hook from canonical spec section 7.5.
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#75-async-callback
 */
export interface AfterTaskHook {
  kind: "callback";
  url: string;
}
