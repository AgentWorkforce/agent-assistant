export interface IngressEnvelope {
  provider: string;
  eventType: string;
  connectionId: string | null;
  providerConfigKey: string;
  payload: unknown;
  rawMeta?: Record<string, unknown>;
  receivedAt: string;
}

export type IngressVerificationResult =
  | { verified: true; trustLevel: 'verified' | 'trusted' }
  | { verified: false; reason: string };

export interface IngressVerifier {
  verify(input: {
    rawBody: string;
    headers: Record<string, string>;
    provider: string;
    providerConfigKey: string;
  }): Promise<IngressVerificationResult> | IngressVerificationResult;
}

export type IngressResolutionResult =
  | {
      resolved: true;
      workspaceId: string;
      assistantId?: string;
      resolvedVia: string;
      metadata?: Record<string, unknown>;
    }
  | {
      resolved: false;
      reason: string;
    };

export interface IngressResolver {
  resolve(envelope: IngressEnvelope): Promise<IngressResolutionResult>;
}

export interface IngressHandlerResult {
  handled: boolean;
  outcome?: 'written' | 'skipped' | 'partial' | 'error';
  reason?: string;
  metrics?: {
    itemsWritten?: number;
    itemsSkipped?: number;
    errorCount?: number;
    durationMs?: number;
  };
  inboxItemId?: string;
}

export interface IngressHandler {
  provider: string;
  eventTypes?: string[];
  handle(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}

export interface IngressRouter {
  register(handler: IngressHandler): void;
  route(input: {
    envelope: IngressEnvelope;
    resolution: IngressResolutionResult & { resolved: true };
  }): Promise<IngressHandlerResult>;
}

export type IngressOutcome =
  | {
      ok: true;
      result: IngressHandlerResult;
      resolution: IngressResolutionResult & { resolved: true };
    }
  | {
      ok: false;
      stage: 'verification' | 'resolution' | 'routing' | 'handler';
      reason: string;
    };
