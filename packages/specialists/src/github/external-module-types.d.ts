declare module '@agent-assistant/coordination' {
  export type SpecialistExecutionStatus = 'complete' | 'partial' | 'failed';

  export interface SpecialistDefinition {
    name: string;
    description: string;
    capabilities: string[];
  }

  export interface SpecialistResult {
    specialistName: string;
    output: string;
    confidence?: number;
    status: SpecialistExecutionStatus;
    metadata?: Record<string, unknown>;
  }

  export interface SpecialistContext {
    turnId: string;
    threadId: string;
    stepIndex: number;
    plan: {
      intent: string;
      steps: Array<{
        specialistName: string;
        instruction: string;
        optional?: boolean;
      }>;
    };
    priorResults: SpecialistResult[];
    connectivity: unknown;
    routingDecision?: {
      mode: string;
      tier: string;
      hints: Record<string, unknown>;
      reason: string;
      escalated: boolean;
      overridden: boolean;
    };
  }

  export interface SpecialistHandler {
    execute(instruction: string, context: SpecialistContext): Promise<SpecialistResult>;
  }

  export interface Specialist extends SpecialistDefinition {
    handler: SpecialistHandler;
  }
}

declare module '@agent-assistant/vfs' {
  export type VfsNodeType = 'file' | 'dir' | 'unknown';

  export interface VfsEntry {
    path: string;
    type: VfsNodeType;
    provider?: string;
    title?: string;
    revision?: string;
    updatedAt?: string;
    size?: number;
    properties?: Record<string, string>;
  }

  export interface VfsSearchResult extends VfsEntry {
    snippet?: string;
  }

  export interface VfsReadResult {
    path: string;
    content: string;
    contentType?: string;
    encoding?: 'utf-8' | 'base64';
    provider?: string;
    title?: string;
    revision?: string;
    updatedAt?: string;
    properties?: Record<string, string>;
  }

  export interface VfsListOptions {
    depth?: number;
    limit?: number;
  }

  export interface VfsSearchOptions {
    provider?: string;
    limit?: number;
  }

  export interface VfsProvider {
    list(path: string, options?: VfsListOptions): Promise<VfsEntry[]>;
    read(path: string): Promise<VfsReadResult | null>;
    search(query: string, options?: VfsSearchOptions): Promise<VfsSearchResult[]>;
    stat?(path: string): Promise<VfsEntry | null>;
  }
}
