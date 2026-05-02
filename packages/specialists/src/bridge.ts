import { randomUUID } from 'node:crypto';

import type {
  GitHubEnumerationParams,
  GitHubInvestigationParams,
  GitHubPullRequestRef,
  GitHubQueryFilterSet,
} from './github/types.js';
import type { LinearEnumerationParams, LinearQueryFilterSet } from './linear/types.js';
import {
  DelegationTimeoutError,
  type DelegationRequestFor,
  type DelegationStatus,
  type DelegationTransport,
  type SpecialistFinding,
  type SpecialistFindings,
  type SpecialistFindingsFor,
} from './shared/findings.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const GITHUB_INVESTIGATE_CAPABILITY: GitHubInvestigationParams['capability'] = 'github.investigate';
const GITHUB_ENUMERATE_CAPABILITY: GitHubEnumerationParams['capability'] = 'github.enumerate';
const LINEAR_ENUMERATE_CAPABILITY: LinearEnumerationParams['capability'] = 'linear.enumerate';

type SpecialistBridgeEvent = {
  event: string;
  capability?: string;
  reason?: string;
  ms?: number;
};

interface LinearDelegationRequestFor<TParams extends LinearEnumerationParams> {
  requestId: string;
  workspaceId?: string;
  capability: TParams['capability'];
  params: TParams;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

interface LinearSpecialistFindingsFor<TParams extends LinearEnumerationParams> {
  requestId: string;
  capability: TParams['capability'];
  status: DelegationStatus;
  summary: string;
  findings: SpecialistFinding[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

interface LinearDelegationTransport {
  delegate<TParams extends LinearEnumerationParams>(
    request: LinearDelegationRequestFor<TParams>,
  ): Promise<LinearSpecialistFindingsFor<TParams>>;
}

export interface SpecialistBridge {
  investigate(
    ref: GitHubPullRequestRef,
    opts?: { timeoutMs?: number },
  ): Promise<SpecialistFindings>;
  enumerate(
    query: string,
    filters?: GitHubQueryFilterSet,
    opts?: { timeoutMs?: number },
  ): Promise<SpecialistFindings>;
  linearEnumerate(
    query: string,
    filters?: LinearQueryFilterSet,
    opts?: { timeoutMs?: number },
  ): Promise<SpecialistFindings>;
}

export interface SpecialistTransports {
  github?: DelegationTransport;
  linear?: DelegationTransport;
  notion?: DelegationTransport;
}

export interface CreateSpecialistBridgeOptions {
  transports: SpecialistTransports;
  defaultTimeoutMs?: number;
  onEvent?: (event: SpecialistBridgeEvent) => void;
}

export interface SpecialistTransportResolver {
  resolveGithub?: () => DelegationTransport | null;
  resolveLinear?: () => DelegationTransport | null;
  resolveNotion?: () => DelegationTransport | null;
}

export function createSpecialistBridge(opts: CreateSpecialistBridgeOptions): SpecialistBridge {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async investigate(ref, callOpts) {
      const params: GitHubInvestigationParams = {
        capability: GITHUB_INVESTIGATE_CAPABILITY,
        query: `${ref.owner}/${ref.repo}#${ref.number}`,
        pr: ref,
      };

      return runGitHubDelegation({
        capability: GITHUB_INVESTIGATE_CAPABILITY,
        params,
        timeoutMs: callOpts?.timeoutMs ?? defaultTimeoutMs,
        transport: opts.transports.github,
        onEvent: opts.onEvent,
      });
    },

    async enumerate(query, filters, callOpts) {
      const params: GitHubEnumerationParams = filters === undefined
        ? {
            capability: GITHUB_ENUMERATE_CAPABILITY,
            query,
          }
        : {
            capability: GITHUB_ENUMERATE_CAPABILITY,
            query,
            filters,
          };

      return runGitHubDelegation({
        capability: GITHUB_ENUMERATE_CAPABILITY,
        params,
        timeoutMs: callOpts?.timeoutMs ?? defaultTimeoutMs,
        transport: opts.transports.github,
        onEvent: opts.onEvent,
      });
    },

    async linearEnumerate(query, filters, callOpts) {
      const params: LinearEnumerationParams = filters === undefined
        ? {
            capability: LINEAR_ENUMERATE_CAPABILITY,
            query,
          }
        : {
            capability: LINEAR_ENUMERATE_CAPABILITY,
            query,
            filters,
          };

      const result = await runLinearDelegation({
        capability: LINEAR_ENUMERATE_CAPABILITY,
        params,
        timeoutMs: callOpts?.timeoutMs ?? defaultTimeoutMs,
        transport: opts.transports.linear,
        onEvent: opts.onEvent,
      });

      return result as unknown as SpecialistFindings;
    },
  };
}

export function resolveSpecialistTransports(
  resolver: SpecialistTransportResolver,
): SpecialistTransports {
  const transports: SpecialistTransports = {};

  const github = resolver.resolveGithub?.() ?? null;
  if (github !== null) {
    transports.github = github;
  }

  const linear = resolver.resolveLinear?.() ?? null;
  if (linear !== null) {
    transports.linear = linear;
  }

  const notion = resolver.resolveNotion?.() ?? null;
  if (notion !== null) {
    transports.notion = notion;
  }

  return transports;
}

async function runGitHubDelegation<TParams extends GitHubInvestigationParams | GitHubEnumerationParams>(args: {
  capability: TParams['capability'];
  params: TParams;
  timeoutMs: number;
  transport: DelegationTransport | undefined;
  onEvent: ((event: SpecialistBridgeEvent) => void) | undefined;
}): Promise<SpecialistFindingsFor<TParams>> {
  const request: DelegationRequestFor<TParams> = {
    requestId: randomUUID(),
    capability: args.capability,
    params: args.params,
    timeoutMs: args.timeoutMs,
  };

  if (args.transport === undefined) {
    return createUnavailableFindings(request, args.onEvent);
  }

  const startedAt = Date.now();

  try {
    return await withDelegationTimeout(
      args.transport.delegate(request),
      request.requestId,
      args.timeoutMs,
    );
  } catch (error) {
    return createFailedFindings({
      requestId: request.requestId,
      capability: request.capability,
      error,
      startedAt,
      onEvent: args.onEvent,
    });
  }
}

async function runLinearDelegation(args: {
  capability: LinearEnumerationParams['capability'];
  params: LinearEnumerationParams;
  timeoutMs: number;
  transport: DelegationTransport | undefined;
  onEvent: ((event: SpecialistBridgeEvent) => void) | undefined;
}): Promise<LinearSpecialistFindingsFor<LinearEnumerationParams>> {
  const request: LinearDelegationRequestFor<LinearEnumerationParams> = {
    requestId: randomUUID(),
    capability: args.capability,
    params: args.params,
    timeoutMs: args.timeoutMs,
  };

  if (args.transport === undefined) {
    return createUnavailableFindings(request, args.onEvent);
  }

  const startedAt = Date.now();
  const transport = args.transport as unknown as LinearDelegationTransport;

  try {
    return await withDelegationTimeout(
      transport.delegate(request),
      request.requestId,
      args.timeoutMs,
    );
  } catch (error) {
    return createFailedFindings({
      requestId: request.requestId,
      capability: request.capability,
      error,
      startedAt,
      onEvent: args.onEvent,
    });
  }
}

function createUnavailableFindings<TRequest extends { requestId: string; capability: string }>(
  request: TRequest,
  onEvent?: (event: SpecialistBridgeEvent) => void,
): {
  requestId: string;
  capability: TRequest['capability'];
  status: 'failed';
  summary: 'transport_unavailable';
  findings: [];
  confidence: 0;
} {
  onEvent?.({
    event: 'specialist_unavailable',
    capability: request.capability,
    reason: 'transport_unavailable',
  });

  return {
    requestId: request.requestId,
    capability: request.capability,
    status: 'failed',
    summary: 'transport_unavailable',
    findings: [],
    confidence: 0,
  };
}

function createFailedFindings<TCapability extends string>(args: {
  requestId: string;
  capability: TCapability;
  error: unknown;
  startedAt: number;
  onEvent: ((event: SpecialistBridgeEvent) => void) | undefined;
}): {
  requestId: string;
  capability: TCapability;
  status: 'failed';
  summary: string;
  findings: [];
  confidence: 0;
} {
  const summary = getErrorMessage(args.error);

  args.onEvent?.({
    event: args.error instanceof DelegationTimeoutError ? 'specialist_timeout' : 'specialist_failed',
    capability: args.capability,
    reason: summary,
    ms: Date.now() - args.startedAt,
  });

  return {
    requestId: args.requestId,
    capability: args.capability,
    status: 'failed',
    summary,
    findings: [],
    confidence: 0,
  };
}

async function withDelegationTimeout<TResult>(
  promise: Promise<TResult>,
  requestId: string,
  timeoutMs: number,
): Promise<TResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<TResult>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new DelegationTimeoutError('Delegation timed out', { requestId, timeoutMs }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unknown delegation error';
}
