import type { Specialist, SpecialistContext, SpecialistResult } from '@agent-assistant/coordination';
import type { VfsProvider, VfsReadResult } from '@agent-assistant/vfs';

import type { SpecialistFinding, SpecialistFindings } from '../shared/findings.js';
import type { GitHubInvestigationParams, GitHubPullRequestRef, GitHubQueryFilterSet } from './types.js';

const SPECIALIST_NAME = 'github-investigator';
const SPECIALIST_VERSION = '1.0.0';
const PR_INVESTIGATION_CAPABILITY = 'pr_investigation';
const DURABLE_EVIDENCE_THRESHOLD_BYTES = 4_096;

type ReviewStatus = 'approved' | 'changes_requested' | 'pending' | 'none';
type EvidenceSourceProvider = 'vfs' | 'github_api';

interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface PrInvestigationRequest {
  requestId: string;
  repo: GitHubRepoRef;
  pr: {
    number: number;
  };
  query?: string;
  allowDurableEvidence?: boolean;
}

export interface GitHubApiPullRequest {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  diff?: string | null;
  url?: string;
  html_url?: string;
  author?: string | { login?: string; name?: string };
  user?: { login?: string; name?: string };
  base?: { ref?: string };
  head?: { ref?: string };
  baseBranch?: string;
  headBranch?: string;
  base_branch?: string;
  head_branch?: string;
  labels?: Array<string | { name?: string }> | string;
  reviewStatus?: string;
  review_status?: string;
}

export interface GitHubApiFallback {
  readPRDiff(
    owner: string,
    repo: string,
    number: number,
  ): Promise<{ data: GitHubApiPullRequest } | GitHubApiPullRequest | null>;
}

export interface DurableEvidenceRef {
  path: string;
  revision?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

export interface EvidenceWriteInput {
  requestId: string;
  evidenceId: string;
  kind: string;
  title: string;
  content: string;
  contentType: string;
  confidence?: number;
}

export interface EvidenceWriter {
  writeEvidence(input: EvidenceWriteInput): Promise<DurableEvidenceRef>;
  finalize?(): Promise<void> | void;
}

export interface GitHubInvestigatorDeps {
  vfs: VfsProvider;
  apiFallback?: GitHubApiFallback | null;
  github?: GitHubApiFallback | null;
  evidenceWriter?: EvidenceWriter | null;
  now?: () => number;
}

interface ParsedPrSections {
  title: string;
  url: string;
  body: string;
  diff: string;
  state: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  labels: string[];
  reviewStatus: ReviewStatus;
}

interface StructuredPr {
  title: string;
  body: string;
  url: string;
  state: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  labels: string[];
  reviewStatus: ReviewStatus;
  filesChanged: string[];
  additions: number;
  deletions: number;
  diff: string;
}

interface FindingsGap {
  description: string;
  reason: 'not_found' | 'unavailable' | 'not_implemented' | 'invalid_request' | 'unknown';
}

interface EvidenceSource {
  provider: EvidenceSourceProvider;
  ref: string;
  asOf: string;
  revision?: string;
  path?: string;
}

interface LoadedRawPr {
  raw: string | null;
  source: EvidenceSourceProvider;
  sourcePath?: string;
  sourceRevision?: string;
  actionCount: number;
  gaps: FindingsGap[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/^#/, ''));
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function readNestedString(record: Record<string, unknown>, key: string, nestedKey: string): string | undefined {
  const value = record[key];
  return isRecord(value) ? readString(value[nestedKey]) : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeReviewStatus(value: unknown): ReviewStatus {
  const normalized = readString(value)?.toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'approved' || normalized === 'changes_requested' || normalized === 'pending') {
    return normalized;
  }

  return 'none';
}

function readLabels(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((label) => (typeof label === 'string' ? label : isRecord(label) ? readString(label.name) : undefined))
    .filter((label): label is string => label !== undefined);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildRepoRoot(owner: string, repo: string): string {
  return `/github/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}`;
}

function buildPullRequestRef(owner: string, repo: string, number: number): string {
  return `${buildRepoRoot(owner, repo)}/pulls/${number}`;
}

function directPrPaths(owner: string, repo: string, number: number): {
  metadata: string[];
  raw: string[];
  diff: string;
} {
  const root = buildPullRequestRef(owner, repo, number);
  return {
    metadata: [`${root}/meta.json`, `${root}/metadata.json`],
    raw: [`${root}/pr.md`, `${root}/pr.txt`, `${root}/summary.md`],
    diff: `${root}/diff.patch`,
  };
}

async function safeRead(vfs: VfsProvider, filePath: string): Promise<VfsReadResult | null> {
  try {
    return await vfs.read(filePath);
  } catch {
    return null;
  }
}

async function readFirst(vfs: VfsProvider, paths: string[]): Promise<VfsReadResult | null> {
  for (const filePath of paths) {
    const result = await safeRead(vfs, filePath);
    if (result) {
      return result;
    }
  }

  return null;
}

function formatPullRequest(
  number: number,
  metadata: Record<string, unknown> | null,
  diff: string | null,
): string | null {
  if (!metadata && !diff) {
    return null;
  }

  const title = metadata ? readString(metadata.title) ?? `PR #${number}` : `PR #${number}`;
  const body = metadata ? readString(metadata.body) ?? '' : '';
  const url = metadata ? readString(metadata.html_url) ?? readString(metadata.url) ?? '' : '';
  const state = metadata ? readString(metadata.state) ?? 'open' : 'open';
  const author = metadata
    ? readString(metadata.author) ??
      readNestedString(metadata, 'author', 'login') ??
      readNestedString(metadata, 'user', 'login') ??
      readNestedString(metadata, 'user', 'name') ??
      'unknown'
    : 'unknown';
  const baseBranch = metadata
    ? readString(metadata.baseBranch) ??
      readString(metadata.base_branch) ??
      readNestedString(metadata, 'base', 'ref') ??
      'unknown'
    : 'unknown';
  const headBranch = metadata
    ? readString(metadata.headBranch) ??
      readString(metadata.head_branch) ??
      readNestedString(metadata, 'head', 'ref') ??
      'unknown'
    : 'unknown';
  const labels = metadata ? readLabels(metadata.labels) : [];
  const reviewStatus = metadata
    ? normalizeReviewStatus(metadata.reviewStatus ?? metadata.review_status)
    : 'none';

  return [
    `Title: ${title}`,
    url ? `URL: ${url}` : '',
    `State: ${state}`,
    `Author: ${author}`,
    `Base Branch: ${baseBranch}`,
    `Head Branch: ${headBranch}`,
    `Labels: ${labels.join(', ')}`,
    `Review Status: ${reviewStatus}`,
    'Body:',
    body,
    'Diff:',
    diff ?? '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function formatApiPullRequest(number: number, data: GitHubApiPullRequest): string | null {
  const metadata: Record<string, unknown> = {
    title: data.title,
    body: data.body ?? '',
    state: data.state,
    html_url: data.html_url ?? data.url,
    author: data.author,
    user: data.user,
    base: data.base,
    head: data.head,
    baseBranch: data.baseBranch,
    headBranch: data.headBranch,
    base_branch: data.base_branch,
    head_branch: data.head_branch,
    labels: data.labels,
    reviewStatus: data.reviewStatus,
    review_status: data.review_status,
  };

  return formatPullRequest(number, metadata, data.diff ?? null);
}

function parsePrSections(raw: string): ParsedPrSections {
  const normalized = raw.trim();
  const titleMatch = normalized.match(/^Title:\s*(.+)$/m);
  const urlMatch = normalized.match(/^URL:\s*(.+)$/m);
  const stateMatch = normalized.match(/^State:\s*(.+)$/m);
  const authorMatch = normalized.match(/^Author:\s*(.+)$/m);
  const baseBranchMatch = normalized.match(/^Base Branch:\s*(.+)$/m);
  const headBranchMatch = normalized.match(/^Head Branch:\s*(.+)$/m);
  const reviewStatusMatch = normalized.match(/^Review Status:\s*(.+)$/m);
  const labelsMatch = normalized.match(/^Labels:\s*(.*)$/m);
  const bodyMarker = normalized.indexOf('\nBody:');
  const diffMarker = normalized.indexOf('\nDiff:');

  const bodyStart = bodyMarker >= 0 ? bodyMarker + '\nBody:'.length : -1;
  const diffStart = diffMarker >= 0 ? diffMarker + '\nDiff:'.length : -1;
  const body =
    bodyStart >= 0
      ? normalized.slice(bodyStart, diffStart >= 0 ? diffMarker : normalized.length).trim()
      : '';
  const diff = diffStart >= 0 ? normalized.slice(diffStart).trim() : '';
  const labels = readLabels(labelsMatch?.[1] ?? '');

  return {
    title: titleMatch?.[1]?.trim() ?? 'Pull request',
    url: urlMatch?.[1]?.trim() ?? '',
    body,
    diff,
    state: stateMatch?.[1]?.trim() ?? 'open',
    author: authorMatch?.[1]?.trim() ?? 'unknown',
    baseBranch: baseBranchMatch?.[1]?.trim() ?? 'unknown',
    headBranch: headBranchMatch?.[1]?.trim() ?? 'unknown',
    labels,
    reviewStatus: normalizeReviewStatus(reviewStatusMatch?.[1]),
  };
}

function extractFilesChanged(diff: string): string[] {
  const files = new Set<string>();

  for (const line of diff.split('\n')) {
    const patchHeader = line.match(/^---\s+(.+?)\s+\((?:added|modified|removed|renamed)\)$/);
    if (patchHeader?.[1]) {
      files.add(patchHeader[1].trim());
      continue;
    }

    const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitHeader?.[2]) {
      files.add(gitHeader[2].trim());
      continue;
    }

    const plusHeader = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (plusHeader?.[1]) {
      files.add(plusHeader[1].trim());
    }
  }

  return [...files];
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function categorizeChanges(filesChanged: string[]): string[] {
  const categories = new Set<string>();

  for (const file of filesChanged) {
    if (/(\.|\/)(test|spec)\./i.test(file) || /__tests__/.test(file)) {
      categories.add('test');
      continue;
    }
    if (/^docs\/|\.md$/i.test(file)) {
      categories.add('docs');
      continue;
    }
    if (/package\.json$|lock|\.ya?ml$|\.json$/i.test(file)) {
      categories.add('config');
      continue;
    }
    categories.add('feature');
  }

  return [...categories];
}

function buildRiskAreas(filesChanged: string[]): Array<Record<string, unknown>> {
  return filesChanged.slice(0, 3).map((file) => {
    const lower = file.toLowerCase();
    if (/auth|security|permission|token/.test(lower)) {
      return {
        file,
        concern: 'Authentication or security-sensitive paths changed and need regression review.',
        severity: 'high',
      };
    }
    if (/config|workflow|deploy|migration/.test(lower)) {
      return {
        file,
        concern: 'Operational or rollout-sensitive changes need validation in deployment paths.',
        severity: 'medium',
      };
    }
    return {
      file,
      concern: 'Behavioral changes should be checked for test coverage and edge-case regressions.',
      severity: /(\.|\/)(test|spec)\./i.test(lower) ? 'low' : 'medium',
    };
  });
}

function buildStructuredPr(raw: string): StructuredPr {
  const parsed = parsePrSections(raw);
  const filesChanged = extractFilesChanged(parsed.diff);
  const { additions, deletions } = countDiffLines(parsed.diff);

  return {
    title: parsed.title,
    body: parsed.body,
    url: parsed.url,
    state: parsed.state || 'open',
    author: parsed.author,
    baseBranch: parsed.baseBranch,
    headBranch: parsed.headBranch,
    labels: parsed.labels,
    reviewStatus: parsed.reviewStatus,
    filesChanged,
    additions,
    deletions,
    diff: parsed.diff,
  };
}

function buildSummary(structured: StructuredPr, riskAreas: Array<Record<string, unknown>>): string {
  const fileList = structured.filesChanged.slice(0, 3).join(', ');
  const topRisk = riskAreas[0];
  const topRiskText =
    topRisk && typeof topRisk.concern === 'string' && typeof topRisk.file === 'string'
      ? ` Top risk: ${topRisk.file} - ${topRisk.concern}`
      : '';

  return `${structured.title} touches ${structured.filesChanged.length} file(s)${
    fileList ? `, including ${fileList}.` : '.'
  }${topRiskText}`;
}

function sourceMetadata(source: EvidenceSource): Record<string, unknown> {
  return {
    provider: source.provider,
    ref: source.ref,
    asOf: source.asOf,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
    ...(source.path === undefined ? {} : { path: source.path }),
  };
}

function buildMetadataFinding(
  request: PrInvestigationRequest,
  structured: StructuredPr,
  source: EvidenceSource,
): SpecialistFinding {
  const metadata = {
    number: request.pr.number,
    title: structured.title,
    state: structured.state,
    author: structured.author,
    baseBranch: structured.baseBranch,
    headBranch: structured.headBranch,
    labels: structured.labels,
    reviewStatus: structured.reviewStatus,
    additions: structured.additions,
    deletions: structured.deletions,
    url: structured.url,
  };

  return {
    title: `PR #${request.pr.number} metadata`,
    body: JSON.stringify(metadata, null, 2),
    ...(structured.url ? { url: structured.url } : {}),
    metadata: {
      id: 'pr-meta',
      kind: 'pr_summary',
      confidence: 0.72,
      source: sourceMetadata(source),
      structured: metadata,
    },
  };
}

async function buildDiffFinding(
  request: PrInvestigationRequest,
  structured: StructuredPr,
  source: EvidenceSource,
  evidenceWriter: EvidenceWriter | null,
): Promise<SpecialistFinding> {
  const riskAreas = buildRiskAreas(structured.filesChanged);
  const structuredContent = {
    filesChanged: structured.filesChanged,
    riskAreas,
    changeCategories: categorizeChanges(structured.filesChanged),
  };
  const changedFiles = structured.filesChanged.map((file) => `- ${file}`).join('\n');
  let body = `Changed files:\n${changedFiles}\n\nDiff:\n${structured.diff}`.trim();
  let durableRef: DurableEvidenceRef | undefined;

  if (
    evidenceWriter &&
    request.allowDurableEvidence !== false &&
    byteLength(body) > DURABLE_EVIDENCE_THRESHOLD_BYTES
  ) {
    durableRef = await evidenceWriter.writeEvidence({
      requestId: request.requestId,
      evidenceId: 'pr-diff',
      kind: 'diff_analysis',
      title: `PR #${request.pr.number} diff analysis`,
      content: body,
      contentType: 'text/markdown',
      confidence: structured.filesChanged.length > 0 ? 0.88 : 0.62,
    });
    body = `Changed files:\n${changedFiles}\n\nDiff analysis persisted as durable evidence.`;
  }

  return {
    title: `PR #${request.pr.number} diff analysis`,
    body,
    metadata: {
      id: 'pr-diff',
      kind: 'diff_analysis',
      confidence: structured.filesChanged.length > 0 ? 0.88 : 0.62,
      source: sourceMetadata(source),
      structured: structuredContent,
      ...(durableRef === undefined ? {} : { durableRef }),
    },
  };
}

async function loadRawPrFromVfs(request: PrInvestigationRequest, vfs: VfsProvider): Promise<LoadedRawPr> {
  const { owner, repo } = request.repo;
  const { number } = request.pr;
  const paths = directPrPaths(owner, repo, number);

  const [metadataResult, rawResult, diffResult] = await Promise.all([
    readFirst(vfs, paths.metadata),
    readFirst(vfs, paths.raw),
    safeRead(vfs, paths.diff),
  ]);

  if (rawResult) {
    return {
      raw: rawResult.content,
      source: 'vfs',
      sourcePath: rawResult.path,
      ...(rawResult.revision === undefined ? {} : { sourceRevision: rawResult.revision }),
      actionCount: 1,
      gaps: [],
    };
  }

  const metadata = metadataResult ? parseJsonRecord(metadataResult.content) : null;
  const raw = formatPullRequest(number, metadata, diffResult?.content ?? null);
  if (raw) {
    const sourcePath = metadataResult?.path ?? diffResult?.path;
    const sourceRevision = metadataResult?.revision ?? diffResult?.revision;
    return {
      raw,
      source: 'vfs',
      ...(sourcePath === undefined ? {} : { sourcePath }),
      ...(sourceRevision === undefined ? {} : { sourceRevision }),
      actionCount: 1,
      gaps: [],
    };
  }

  return {
    raw: null,
    source: 'vfs',
    actionCount: 1,
    gaps: [
      {
        description: `PR #${number} in ${owner}/${repo} was unavailable from VFS.`,
        reason: 'not_found',
      },
    ],
  };
}

function extractApiData(result: { data: GitHubApiPullRequest } | GitHubApiPullRequest | null): GitHubApiPullRequest | null {
  if (!result) {
    return null;
  }

  if (isRecord(result) && isRecord(result.data)) {
    return result.data as GitHubApiPullRequest;
  }

  return isRecord(result) ? (result as GitHubApiPullRequest) : null;
}

async function loadRawPr(request: PrInvestigationRequest, deps: GitHubInvestigatorDeps): Promise<LoadedRawPr> {
  const loadedFromVfs = await loadRawPrFromVfs(request, deps.vfs);
  if (loadedFromVfs.raw) {
    return loadedFromVfs;
  }

  const apiFallback = deps.apiFallback ?? deps.github ?? null;
  if (!apiFallback) {
    return loadedFromVfs;
  }

  const { owner, repo } = request.repo;
  const { number } = request.pr;
  const result = extractApiData(await apiFallback.readPRDiff(owner, repo, number));
  if (!result || (!readString(result.title) && !readString(result.diff))) {
    return {
      raw: null,
      source: 'github_api',
      actionCount: loadedFromVfs.actionCount + 1,
      gaps: [
        {
          description: `PR #${number} in ${owner}/${repo} could not be loaded from GitHub API fallback.`,
          reason: 'unavailable',
        },
      ],
    };
  }

  return {
    raw: formatApiPullRequest(number, result),
    source: 'github_api',
    actionCount: loadedFromVfs.actionCount + 1,
    gaps: [],
  };
}

function createFindings(input: {
  request: PrInvestigationRequest;
  status: SpecialistFindings['status'];
  summary: string;
  findings: SpecialistFinding[];
  confidence: number;
  metadata: Record<string, unknown>;
}): SpecialistFindings {
  return {
    requestId: input.request.requestId,
    capability: PR_INVESTIGATION_CAPABILITY,
    status: input.status,
    summary: input.summary,
    findings: input.findings,
    confidence: input.confidence,
    metadata: {
      specialistName: SPECIALIST_NAME,
      specialistVersion: SPECIALIST_VERSION,
      ...input.metadata,
    },
  };
}

function failedFindings(
  request: PrInvestigationRequest,
  summary: string,
  gaps: FindingsGap[],
  confidence: number,
  metadata: Record<string, unknown>,
): SpecialistFindings {
  return createFindings({
    request,
    status: 'failed',
    summary,
    findings: [],
    confidence,
    metadata: {
      gaps,
      recommendedNext: [
        {
          type: 'fallback_inline',
          description: 'Coordinator should fall back to the inline GitHub PR read path.',
        },
      ],
      ...metadata,
    },
  });
}

export async function investigatePullRequest(
  request: PrInvestigationRequest,
  deps: GitHubInvestigatorDeps,
): Promise<SpecialistFindings> {
  const startedAt = deps.now?.() ?? Date.now();
  const producedAt = new Date(startedAt).toISOString();
  const evidenceWriter = deps.evidenceWriter ?? null;

  try {
    const loaded = await loadRawPr(request, deps);
    if (!loaded.raw) {
      return failedFindings(
        request,
        `Unable to investigate PR #${request.pr.number}.`,
        loaded.gaps,
        0.2,
        {
          durationMs: (deps.now?.() ?? Date.now()) - startedAt,
          actionCount: loaded.actionCount,
          durableEvidenceCount: 0,
          producedAt,
        },
      );
    }

    const structured = buildStructuredPr(loaded.raw);
    const source: EvidenceSource = {
      provider: loaded.source,
      ref: `${buildPullRequestRef(request.repo.owner, request.repo.repo, request.pr.number)}`,
      asOf: producedAt,
      ...(loaded.sourcePath === undefined ? {} : { path: loaded.sourcePath }),
      ...(loaded.sourceRevision === undefined ? {} : { revision: loaded.sourceRevision }),
    };
    const metaFinding = buildMetadataFinding(request, structured, source);
    const diffFinding = await buildDiffFinding(request, structured, source, evidenceWriter);
    await evidenceWriter?.finalize?.();

    const findings = [metaFinding, diffFinding];
    const riskAreas =
      (diffFinding.metadata?.structured as { riskAreas?: Array<Record<string, unknown>> } | undefined)?.riskAreas ??
      [];
    const gaps: FindingsGap[] = [
      {
        description: 'PR comments and review discussion are not implemented in the v1 specialist path.',
        reason: 'not_implemented',
      },
      ...loaded.gaps,
    ];
    const durableEvidenceCount = findings.filter((finding) => finding.metadata?.durableRef).length;

    return createFindings({
      request,
      status: 'complete',
      summary: buildSummary(structured, riskAreas),
      findings,
      confidence: 0.86,
      metadata: {
        gaps,
        recommendedNext: [
          {
            type: 'none',
            description: 'No further specialist action required for the current PR investigation.',
          },
        ],
        durationMs: (deps.now?.() ?? Date.now()) - startedAt,
        actionCount: loaded.actionCount,
        durableEvidenceCount,
        producedAt,
      },
    });
  } catch (error) {
    return failedFindings(
      request,
      `Unable to investigate PR #${request.pr.number}.`,
      [
        {
          description: error instanceof Error ? error.message : String(error),
          reason: 'unknown',
        },
      ],
      0.1,
      {
        durationMs: (deps.now?.() ?? Date.now()) - startedAt,
        actionCount: 1,
        durableEvidenceCount: 0,
        producedAt,
      },
    );
  }
}

function readRepoRef(value: unknown): GitHubRepoRef | null {
  if (typeof value === 'string') {
    const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return match ? { owner: match[1]!, repo: match[2]! } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const owner = readString(value.owner);
  const repo = readString(value.repo) ?? readString(value.name);
  return owner && repo ? { owner, repo } : null;
}

function readPrNumber(value: unknown): number | undefined {
  if (isRecord(value)) {
    return readNumber(value.number) ?? readNumber(value.id);
  }

  return readNumber(value);
}

function readFilters(value: unknown): GitHubQueryFilterSet | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const filters: GitHubQueryFilterSet = {};
  for (const [key, filterValue] of Object.entries(value)) {
    if (!Array.isArray(filterValue)) {
      continue;
    }

    const strings = filterValue
      .map((item) => (typeof item === 'string' ? item : undefined))
      .filter((item): item is string => item !== undefined);
    if (strings.length > 0) {
      filters[key] = strings;
    }
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function parseTargetFromText(text: string, filters?: GitHubQueryFilterSet): GitHubPullRequestRef | null {
  const githubUrl = text.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/i);
  if (githubUrl) {
    return {
      owner: githubUrl[1]!,
      repo: githubUrl[2]!,
      number: Number(githubUrl[3]),
    };
  }

  const compact = text.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/);
  if (compact) {
    return {
      owner: compact[1]!,
      repo: compact[2]!,
      number: Number(compact[3]),
    };
  }

  const repoFilter = filters?.repo?.[0];
  const inlineRepo = text.match(/\brepo:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/)?.[1];
  const genericRepo = text.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/)?.[1];
  const repo = readRepoRef(repoFilter ?? inlineRepo ?? genericRepo);
  const numberMatch =
    text.match(/\b(?:pr|pull request|pull)\s*#?\s*(\d+)\b/i) ?? text.match(/#(\d+)\b/);
  const number = numberMatch ? Number(numberMatch[1]) : undefined;

  return repo && number ? { ...repo, number } : null;
}

function requestIdFromContext(context?: SpecialistContext): string {
  if (!context) {
    return `github-investigator-${Date.now()}`;
  }

  return `${context.turnId || 'turn'}-${context.stepIndex}`;
}

function requestFromRecord(record: Record<string, unknown>, fallbackRequestId: string): PrInvestigationRequest | null {
  const candidates = [record.parameters, record.params, record].filter(isRecord);
  const requestId = readString(record.requestId) ?? fallbackRequestId;
  const instruction = readString(record.instruction);
  const bounds = isRecord(record.bounds) ? record.bounds : null;
  const allowDurableEvidence =
    typeof bounds?.allowDurableEvidence === 'boolean' ? bounds.allowDurableEvidence : undefined;

  for (const candidate of candidates) {
    const directRepo = readRepoRef(candidate.repo) ?? readRepoRef(candidate.repository);
    const directNumber =
      readPrNumber(candidate.pr) ?? readPrNumber(candidate.pullRequest) ?? readPrNumber(candidate.number);
    if (directRepo && directNumber) {
      return {
        requestId,
        repo: directRepo,
        pr: { number: directNumber },
        ...(instruction === undefined ? {} : { query: instruction }),
        ...(allowDurableEvidence === undefined ? {} : { allowDurableEvidence }),
      };
    }

    const query = readString(candidate.query) ?? instruction;
    const filters = readFilters(candidate.filters);
    if (query) {
      const parsed = parseTargetFromText(query, filters);
      if (parsed) {
        return {
          requestId,
          repo: { owner: parsed.owner, repo: parsed.repo },
          pr: { number: parsed.number },
          query,
          ...(allowDurableEvidence === undefined ? {} : { allowDurableEvidence }),
        };
      }
    }
  }

  return null;
}

export function parseGitHubInvestigationInstruction(
  instruction: string,
  context?: SpecialistContext,
): PrInvestigationRequest | null {
  const fallbackRequestId = requestIdFromContext(context);
  try {
    const parsed = JSON.parse(instruction) as unknown;
    if (isRecord(parsed)) {
      const request = requestFromRecord(parsed, fallbackRequestId);
      if (request) {
        return request;
      }
    }
  } catch {
    // Plain text instructions are handled below.
  }

  const target = parseTargetFromText(instruction);
  if (!target) {
    return null;
  }

  return {
    requestId: fallbackRequestId,
    repo: { owner: target.owner, repo: target.repo },
    pr: { number: target.number },
    query: instruction,
  };
}

function unparseableRequest(instruction: string, context?: SpecialistContext): PrInvestigationRequest {
  return {
    requestId: requestIdFromContext(context),
    repo: { owner: 'unknown', repo: 'unknown' },
    pr: { number: 0 },
    query: instruction,
    allowDurableEvidence: false,
  };
}

export async function investigateGitHub(
  params: GitHubInvestigationParams,
  deps: GitHubInvestigatorDeps,
): Promise<SpecialistFindings> {
  const direct = params.pr
    ? {
        requestId: `github-investigation-${params.pr.owner}-${params.pr.repo}-${params.pr.number}`,
        repo: { owner: params.pr.owner, repo: params.pr.repo },
        pr: { number: params.pr.number },
        query: params.query,
      }
    : null;
  const request =
    direct ??
    requestFromRecord(
      {
        requestId: 'github-investigation',
        params,
      },
      'github-investigation',
    );

  if (!request) {
    return failedFindings(
      unparseableRequest(params.query),
      'Unable to investigate PR because the instruction did not include a GitHub pull request target.',
      [
        {
          description: 'Expected a GitHub PR URL, owner/repo#number, repo filter with PR number, or params.pr.',
          reason: 'invalid_request',
        },
      ],
      0.05,
      {
        actionCount: 0,
        durableEvidenceCount: 0,
        producedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
      },
    );
  }

  return investigatePullRequest(request, deps);
}

function toSpecialistResult(findings: SpecialistFindings): SpecialistResult {
  return {
    specialistName: SPECIALIST_NAME,
    output: JSON.stringify(findings, null, 2),
    status: findings.status,
    ...(findings.confidence === undefined ? {} : { confidence: findings.confidence }),
    metadata: {
      requestId: findings.requestId,
      capability: findings.capability,
      findings,
    },
  };
}

export function createGitHubInvestigator(deps: GitHubInvestigatorDeps): Specialist {
  return {
    name: SPECIALIST_NAME,
    description: 'Investigates GitHub pull requests using VFS evidence with an optional API fallback.',
    capabilities: [PR_INVESTIGATION_CAPABILITY],
    handler: {
      async execute(instruction, context) {
        const request = parseGitHubInvestigationInstruction(instruction, context);
        if (!request) {
          return toSpecialistResult(
            failedFindings(
              unparseableRequest(instruction, context),
              'Unable to investigate PR because the instruction did not include a GitHub pull request target.',
              [
                {
                  description: 'Expected a GitHub PR URL, owner/repo#number, or repo filter with PR number.',
                  reason: 'invalid_request',
                },
              ],
              0.05,
              {
                actionCount: 0,
                durableEvidenceCount: 0,
                producedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
              },
            ),
          );
        }

        return toSpecialistResult(await investigatePullRequest(request, deps));
      },
    },
  };
}
