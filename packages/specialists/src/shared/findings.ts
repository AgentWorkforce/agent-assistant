import type {
  GitHubCapabilityParams,
  GitHubEnumerationParams,
  GitHubInvestigationParams,
} from '../github/types.js';

export type DelegationStatus = 'complete' | 'partial' | 'failed';

export interface DelegationRequestFor<TParams extends GitHubCapabilityParams> {
  requestId: string;
  capability: TParams['capability'];
  params: TParams;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export type DelegationRequest =
  | DelegationRequestFor<GitHubInvestigationParams>
  | DelegationRequestFor<GitHubEnumerationParams>;

export interface SpecialistFinding {
  title: string;
  body?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface SpecialistFindingsFor<TParams extends GitHubCapabilityParams> {
  requestId: string;
  capability: TParams['capability'];
  status: DelegationStatus;
  summary: string;
  findings: SpecialistFinding[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export type SpecialistFindings =
  | SpecialistFindingsFor<GitHubInvestigationParams>
  | SpecialistFindingsFor<GitHubEnumerationParams>;

export interface DelegationTransport {
  delegate<TParams extends GitHubCapabilityParams>(
    request: DelegationRequestFor<TParams>,
  ): Promise<SpecialistFindingsFor<TParams>>;
}

export class DelegationTimeoutError extends Error {
  readonly requestId?: string;
  readonly timeoutMs?: number;

  constructor(message = 'Delegation timed out', options: { requestId?: string; timeoutMs?: number } = {}) {
    super(message);
    this.name = 'DelegationTimeoutError';

    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }

    if (options.timeoutMs !== undefined) {
      this.timeoutMs = options.timeoutMs;
    }
  }
}
