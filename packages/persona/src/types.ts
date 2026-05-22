export interface RouterConfig {
  endpoint: string;
  method?: "POST";
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface SandboxBorrowConfig {
  snapshot: string;
  lifecycle?: "ephemeral" | "warm-pool";
  ttlSeconds?: number;
  maxConcurrentBorrows?: number;
  capabilities?: string[];
}

export type PersonaExecutor =
  | { kind: "ephemeral-sandbox" }
  | { kind: "http-delegate"; router: RouterConfig }
  | { kind: "hybrid"; router: RouterConfig; sandbox: SandboxBorrowConfig };

export type PersonaTrigger =
  | { kind: "cron"; cron: string; timezone?: string; name?: string }
  | { kind: "webhook"; provider: string; event?: string; path?: string }
  | { kind: "inbox"; channel?: string; event?: string };

export interface PersonaMemoryConfig {
  backend?: "agent-memory" | "supermemory" | "none";
  namespace?: string;
}

export interface PersonaDeliveryConfig {
  mode?: "inline" | "callback" | "direct";
  callbackUrl?: string;
}

export interface PersonaDefinition {
  id: string;
  displayName: string;
  version: string;
  description?: string;
  ownerService?: "sage" | "nightcto" | "msd-app" | "workforce" | (string & {});
  sourceTag?: string;
  executor: PersonaExecutor;
  triggers?: PersonaTrigger[];
  memory?: PersonaMemoryConfig;
  delivery?: PersonaDeliveryConfig;
  metadata?: Record<string, unknown>;
}
