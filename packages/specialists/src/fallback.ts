import type { SpecialistBridge } from './bridge.js';
import type { GitHubPullRequestRef, GitHubQueryFilterSet } from './github/types.js';
import type { SpecialistFindings } from './shared/findings.js';

const OWNER_REPO_PATTERN = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/g;
const NUMBER_REF_PATTERN = /#(\d+)\b/;
const LINEAR_TICKET_PATTERN = /\b[A-Z]{2,5}-\d+\b/;
const LINEAR_WORD_PATTERN = /\bLinear\b/;
const GITHUB_KEYWORD_PATTERN = /\b(?:github|repo|pr|pull request|issue|commit)\b/i;

type RoutedFallbackRoute = Exclude<SpecialistFallbackResult['route'], 'none'>;

interface OwnerRepoRef {
  owner: string;
  repo: string;
}

export interface SpecialistFallbackInput {
  message: string;
  threadHistory?: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>;
}

export interface SpecialistFallbackResult {
  route: 'github_investigate' | 'github_enumerate' | 'linear_enumerate' | 'none';
  findings?: SpecialistFindings;
  /** When route='none', caller should call truthfulFailureReply. */
  truthfulFailureReason?: string;
}

export interface RunSpecialistFallbackOptions {
  bridge: SpecialistBridge;
  timeoutMs?: number;
}

export async function runSpecialistFallback(
  input: SpecialistFallbackInput,
  opts: RunSpecialistFallbackOptions,
): Promise<SpecialistFallbackResult> {
  const message = input.message;
  const ownerRepo = parseOwnerRepo(message);
  const callOpts = opts.timeoutMs === undefined ? undefined : { timeoutMs: opts.timeoutMs };

  // Keep precedence aligned with Sage spec section 1: first match wins.
  if (ownerRepo !== null) {
    const pullRequestRef = parseNumberedRef(message, ownerRepo);
    if (pullRequestRef !== null) {
      const findings = await opts.bridge.investigate(pullRequestRef, callOpts);
      return toRoutedResult('github_investigate', findings);
    }
  }

  if (LINEAR_TICKET_PATTERN.test(message) || LINEAR_WORD_PATTERN.test(message)) {
    const findings = await opts.bridge.linearEnumerate(message, undefined, callOpts);
    return toRoutedResult('linear_enumerate', findings);
  }

  if (ownerRepo !== null && GITHUB_KEYWORD_PATTERN.test(message)) {
    const findings = await opts.bridge.enumerate(
      message,
      createRepoFilter(ownerRepo),
      callOpts,
    );
    return toRoutedResult('github_enumerate', findings);
  }

  return {
    route: 'none',
    truthfulFailureReason: 'no_routable_keywords',
  };
}

function parseNumberedRef(message: string, ownerRepo: OwnerRepoRef): GitHubPullRequestRef | null {
  const match = NUMBER_REF_PATTERN.exec(message);
  if (!match) {
    return null;
  }

  const rawNumber = match[1];
  if (rawNumber === undefined) {
    return null;
  }

  const number = Number.parseInt(rawNumber, 10);
  if (!Number.isSafeInteger(number)) {
    return null;
  }

  return {
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    number,
  };
}

function parseOwnerRepo(message: string): OwnerRepoRef | null {
  for (const match of message.matchAll(OWNER_REPO_PATTERN)) {
    const fullMatch = match[0];
    const owner = match[1];
    const repo = match[2];
    const start = match.index;

    if (fullMatch === undefined || owner === undefined || repo === undefined || start === undefined) {
      continue;
    }

    if (message[start + fullMatch.length] === '/') {
      continue;
    }

    return { owner, repo };
  }

  return null;
}

function createRepoFilter(ownerRepo: OwnerRepoRef): GitHubQueryFilterSet {
  return {
    repo: [`${ownerRepo.owner}/${ownerRepo.repo}`],
  };
}

function toRoutedResult(
  route: RoutedFallbackRoute,
  findings: SpecialistFindings,
): SpecialistFallbackResult {
  if (findings.status === 'failed') {
    return {
      route,
      findings,
      truthfulFailureReason: 'specialist_failed',
    };
  }

  return {
    route,
    findings,
  };
}
