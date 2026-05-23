/**
 * @agent-assistant/persona canonical persona schema.
 *
 * Ports canonical spec section 6 to TypeScript:
 * https://github.com/AgentWorkforce/sage/blob/main/specs/proactive-unification.md#6-persona-schema
 *
 * Types-only module. No runtime exports beyond {@link PERSONA_SCHEMA_URL}.
 */

/** Canonical schema URL constant - see canonical spec section 6. */
export const PERSONA_SCHEMA_URL =
  "https://schemas.agent-assistant.dev/persona/0.1.0/persona.schema.json" as const;

/** Root persona document - see canonical spec section 6. */
export interface PersonaDefinition {
  $schema?: typeof PERSONA_SCHEMA_URL | string;
  id: string;
  intent: string;
  description: string;
  tags?: string[];
  cloud?: boolean;
  useSubscription?: boolean;
  ownerService?: string;
  schedules?: PersonaSchedule[];
  inbox?: InboxTrigger[];
  integrations?: Record<string, IntegrationDecl>;
  watch?: WatchRule[];
  mount?: PersonaMount;
  executor: PersonaExecutor;
  memory?: MemoryConfig;
  delivery?: DeliveryChannel[];
  onEvent?: string;
  harness?: "claude" | "codex" | "opencode";
  model?: string;
  systemPrompt?: string;
  harnessSettings?: HarnessSettings;
  inputs?: Record<string, InputDecl>;
}

/** Executor selector - see canonical spec section 6 executor block. */
export type PersonaExecutor =
  | { kind: "ephemeral-sandbox" }
  | { kind: "http-delegate"; router: RouterConfig }
  | { kind: "hybrid"; router: RouterConfig; sandbox: SandboxBorrowConfig };

/** Router configuration - see canonical spec section 6 executor block. */
export interface RouterConfig {
  kind: "workerd-service" | "node-service" | "edge-function";
  url: string;
  auth: {
    kind: "shared-secret";
    envVar: string;
  };
  timeoutSeconds: number;
  healthcheck?: string;
}

/** Sandbox borrow configuration - see canonical spec section 6 executor block. */
export interface SandboxBorrowConfig {
  snapshot: string;
  lifecycle: "warm-pool" | "ephemeral";
  reuseLabels?: string[];
  idleStopMinutes?: number;
  borrowProtocol: "v1";
  maxConcurrentBorrows: number;
  borrowEndpoint?: string;
  releaseEndpoint?: string;
}

/** Cron trigger configuration - see canonical spec section 6 schedules. */
export interface PersonaSchedule {
  name: string;
  cron: string;
  tz?: string;
}

/** Chat and message trigger configuration - see canonical spec section 6 inbox. */
export interface InboxTrigger {
  source: "relaycast" | "slack" | "discord";
  pattern: string;
}

/** Provider integration declaration - see canonical spec section 6 integrations. */
export interface IntegrationDecl {
  triggers?: Array<{ on: string }>;
  scopes?: string[];
}

/** File watch rule - see canonical spec section 6 watch. */
export interface WatchRule {
  paths: string[];
  events: Array<"created" | "updated" | "deleted">;
  debounceMs?: number;
  match?: string;
}

/** Mount configuration - see canonical spec section 6 mount. */
export interface PersonaMount {
  enabled?: boolean;
  ignoredPatterns?: string[];
  readonlyPatterns?: string[];
}

/** Memory backend configuration - see canonical spec section 6 memory. */
export interface MemoryConfig {
  enabled: boolean;
  backend?: "agent-memory" | "supermemory";
  scopes?: string[];
  ttlDays?: number;
}

/** Delivery channel configuration - see canonical spec section 6 delivery. */
export interface DeliveryChannel {
  kind: "slack-dm" | "slack-post" | "relaycast" | "email" | "github-comment" | "linear-comment";
  configEnv?: string;
  target?: string;
}

/** Runtime harness options for ephemeral-sandbox personas. */
export interface HarnessSettings {
  reasoning?: "low" | "medium" | "high";
  timeoutSeconds?: number;
  [key: string]: unknown;
}

/** Declarative input exposed to an ephemeral-sandbox persona handler. */
export interface InputDecl {
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  [key: string]: unknown;
}
