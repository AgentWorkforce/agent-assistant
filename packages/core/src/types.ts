import type { TraitsProvider } from '@agent-assistant/traits';

export interface InboundMessage {
  id: string;
  surfaceId: string;
  sessionId?: string;
  userId: string;
  workspaceId?: string;
  text: string;
  raw: unknown;
  receivedAt: string;
  capability: string;
}

export interface OutboundEvent {
  surfaceId?: string;
  sessionId?: string;
  text: string;
  format?: unknown;
}

export interface RuntimeStatus {
  ready: boolean;
  startedAt: string | null;
  registeredSubsystems: string[];
  registeredCapabilities: string[];
  inFlightHandlers: number;
}

export interface RuntimeConstraints {
  handlerTimeoutMs?: number;
  maxConcurrentHandlers?: number;
}

export interface RelayInboundAdapter {
  onMessage(handler: (message: InboundMessage) => void): void;
  offMessage(handler: (message: InboundMessage) => void): void;
}

export interface RelayOutboundAdapter {
  send(event: OutboundEvent): Promise<void>;
  fanout?(event: OutboundEvent, attachedSurfaceIds: string[]): Promise<void>;
}

export interface ContextLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface AssistantRuntime {
  readonly definition: Readonly<AssistantDefinition>;
  emit(event: OutboundEvent): Promise<void>;
  dispatch(message: InboundMessage): Promise<void>;
  register<T>(name: string, subsystem: T): AssistantRuntime;
  get<T>(name: string): T;
  status(): RuntimeStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CapabilityContext {
  runtime: AssistantRuntime;
  log: ContextLogger;
}

export type CapabilityHandler = (
  message: InboundMessage,
  context: CapabilityContext,
) => Promise<void> | void;

export interface AssistantHooks {
  onStart?: (runtime: AssistantRuntime) => Promise<void> | void;
  onStop?: (runtime: AssistantRuntime) => Promise<void> | void;
  onMessage?: (message: InboundMessage) => boolean | Promise<boolean>;
  onError?: (error: Error, message: InboundMessage) => void;
}

export interface AssistantDefinition {
  id: string;
  name: string;
  description?: string;
  traits?: TraitsProvider;
  capabilities: Record<string, CapabilityHandler>;
  hooks?: AssistantHooks;
  constraints?: RuntimeConstraints;
}
