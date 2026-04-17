import type {
  Specialist,
  SpecialistContext,
  SpecialistExecutionStatus,
  SpecialistResult,
} from '@agent-assistant/coordination';
import type { VfsProvider, VfsReadResult } from '@agent-assistant/vfs';

import type { DelegationStatus, SpecialistFinding } from './findings.js';

const DEFAULT_DURABLE_EVIDENCE_THRESHOLD_BYTES = 4_096;

export type InvestigatorTarget = Record<string, unknown>;

export interface InvestigatorPaths {
  metadata: string[];
  raw?: string[];
  diff?: string;
}

export interface InvestigatorAdapter<TEntity> {
  capability: string;
  specialistName: string;
  specialistVersion: string;
  paths(target: InvestigatorTarget): InvestigatorPaths;
  parse(raw: string): TEntity | null;
  toEvidence(entity: TEntity, target: InvestigatorTarget): SpecialistFinding[];
  apiFallback?(target: InvestigatorTarget): Promise<TEntity | null>;
  durableEvidenceThresholdBytes?: number;
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

export interface InvestigatorDeps {
  vfs: VfsProvider;
  evidenceWriter?: EvidenceWriter | null;
  now?: () => number;
  parseTarget?(instruction: string, context?: SpecialistContext): InvestigatorTarget | null;
  describeTarget?(target: InvestigatorTarget): string;
  summarize?(input: {
    target: InvestigatorTarget;
    findings: SpecialistFinding[];
    source: InvestigatorEvidenceSource;
  }): string;
  confidence?(input: {
    target: InvestigatorTarget;
    findings: SpecialistFinding[];
    source: InvestigatorEvidenceSource;
  }): number | undefined;
}

export type InvestigatorEvidenceSourceProvider = 'vfs' | 'apiFallback';

export interface InvestigatorEvidenceSource {
  provider: InvestigatorEvidenceSourceProvider;
  asOf: string;
  path?: string;
  revision?: string;
}

export interface InvestigatorGap {
  description: string;
  reason: 'not_found' | 'unavailable' | 'invalid_request' | 'unknown';
}

export interface InvestigatorFindings {
  requestId: string;
  capability: string;
  status: DelegationStatus;
  summary: string;
  findings: SpecialistFinding[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

interface LoadedEntity<TEntity> {
  entity: TEntity | null;
  source?: InvestigatorEvidenceSource;
  actionCount: number;
  gaps: InvestigatorGap[];
}

interface ReadAttempt {
  result: VfsReadResult | null;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requestIdFromContext(adapter: InvestigatorAdapter<unknown>, context?: SpecialistContext): string {
  if (context) {
    return `${context.turnId || adapter.specialistName}-${context.stepIndex}`;
  }

  return `${adapter.specialistName}-${Date.now()}`;
}

function readRequestId(target: InvestigatorTarget, adapter: InvestigatorAdapter<unknown>, context?: SpecialistContext): string {
  return readString(target.requestId) ?? requestIdFromContext(adapter, context);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultParseTarget(
  instruction: string,
  adapter: InvestigatorAdapter<unknown>,
  context?: SpecialistContext,
): InvestigatorTarget {
  const fallbackRequestId = requestIdFromContext(adapter, context);
  const parsed = parseJsonObject(instruction);
  if (!parsed) {
    return {
      requestId: fallbackRequestId,
      instruction,
      query: instruction,
    };
  }

  const requestId = readString(parsed.requestId) ?? fallbackRequestId;
  const candidates = [parsed.target, parsed.params, parsed.parameters, parsed].filter(isRecord);
  const target = candidates[0] ?? parsed;
  return {
    ...target,
    requestId: readString(target.requestId) ?? requestId,
  };
}

function parseTarget(
  instruction: string,
  context: SpecialistContext | undefined,
  adapter: InvestigatorAdapter<unknown>,
  deps: InvestigatorDeps,
): InvestigatorTarget | null {
  if (deps.parseTarget) {
    return deps.parseTarget(instruction, context);
  }

  return defaultParseTarget(instruction, adapter, context);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeRead(vfs: VfsProvider, filePath: string): Promise<ReadAttempt> {
  try {
    return { result: await vfs.read(filePath) };
  } catch (error) {
    return { result: null, error: errorMessage(error) };
  }
}

async function readFirst(vfs: VfsProvider, paths: string[]): Promise<{
  result: VfsReadResult | null;
  actionCount: number;
  errors: string[];
}> {
  let actionCount = 0;
  const errors: string[] = [];

  for (const filePath of paths) {
    actionCount += 1;
    const attempt = await safeRead(vfs, filePath);
    if (attempt.error) {
      errors.push(`${filePath}: ${attempt.error}`);
    }
    if (attempt.result) {
      return { result: attempt.result, actionCount, errors };
    }
  }

  return { result: null, actionCount, errors };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatVfsBlob(metadata: VfsReadResult | null, diff: VfsReadResult | null): string | null {
  if (!metadata && !diff) {
    return null;
  }

  return [
    metadata ? `Metadata:\n${metadata.content}` : '',
    diff ? `Diff:\n${diff.content}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function sourceFromRead(result: VfsReadResult, producedAt: string): InvestigatorEvidenceSource {
  return {
    provider: 'vfs',
    asOf: producedAt,
    path: result.path,
    ...(result.revision === undefined ? {} : { revision: result.revision }),
  };
}

function failureGap(target: InvestigatorTarget, deps: InvestigatorDeps): InvestigatorGap {
  const label = deps.describeTarget?.(target) ?? readString(target.query) ?? readString(target.instruction) ?? 'target';
  return {
    description: `${label} was unavailable from VFS and API fallback.`,
    reason: 'not_found',
  };
}

async function parseVfsCandidate<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  raw: string,
  source: InvestigatorEvidenceSource,
): Promise<LoadedEntity<TEntity> | null> {
  const entity = adapter.parse(raw);
  if (!entity) {
    return null;
  }

  return {
    entity,
    source,
    actionCount: 0,
    gaps: [],
  };
}

async function loadEntityFromVfs<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  deps: InvestigatorDeps,
  target: InvestigatorTarget,
  producedAt: string,
): Promise<LoadedEntity<TEntity>> {
  const paths = adapter.paths(target);
  const errors: string[] = [];
  let actionCount = 0;

  if (paths.raw && paths.raw.length > 0) {
    const raw = await readFirst(deps.vfs, paths.raw);
    actionCount += raw.actionCount;
    errors.push(...raw.errors);
    if (raw.result) {
      const loaded = await parseVfsCandidate(adapter, raw.result.content, sourceFromRead(raw.result, producedAt));
      if (loaded) {
        return { ...loaded, actionCount, gaps: [] };
      }
    }
  }

  const metadata = await readFirst(deps.vfs, paths.metadata);
  actionCount += metadata.actionCount;
  errors.push(...metadata.errors);

  let diffResult: VfsReadResult | null = null;
  if (paths.diff) {
    actionCount += 1;
    const diff = await safeRead(deps.vfs, paths.diff);
    if (diff.error) {
      errors.push(`${paths.diff}: ${diff.error}`);
    }
    diffResult = diff.result;
  }

  const formatted = formatVfsBlob(metadata.result, diffResult);
  if (formatted) {
    const sourceResult = metadata.result ?? diffResult;
    const loaded = sourceResult
      ? await parseVfsCandidate(adapter, formatted, sourceFromRead(sourceResult, producedAt))
      : null;
    if (loaded) {
      return { ...loaded, actionCount, gaps: [] };
    }
  }

  if (metadata.result) {
    const loaded = await parseVfsCandidate(
      adapter,
      metadata.result.content,
      sourceFromRead(metadata.result, producedAt),
    );
    if (loaded) {
      return { ...loaded, actionCount, gaps: [] };
    }
  }

  if (diffResult) {
    const loaded = await parseVfsCandidate(adapter, diffResult.content, sourceFromRead(diffResult, producedAt));
    if (loaded) {
      return { ...loaded, actionCount, gaps: [] };
    }
  }

  return {
    entity: null,
    actionCount,
    gaps: errors.map((description) => ({ description, reason: 'unavailable' })),
  };
}

async function loadEntity<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  deps: InvestigatorDeps,
  target: InvestigatorTarget,
  producedAt: string,
): Promise<LoadedEntity<TEntity>> {
  const loadedFromVfs = await loadEntityFromVfs(adapter, deps, target, producedAt);
  if (loadedFromVfs.entity) {
    return loadedFromVfs;
  }

  if (!adapter.apiFallback) {
    return {
      ...loadedFromVfs,
      gaps: loadedFromVfs.gaps.length > 0 ? loadedFromVfs.gaps : [failureGap(target, deps)],
    };
  }

  const entity = await adapter.apiFallback(target);
  if (!entity) {
    return {
      entity: null,
      source: { provider: 'apiFallback', asOf: producedAt },
      actionCount: loadedFromVfs.actionCount + 1,
      gaps: [
        ...loadedFromVfs.gaps,
        {
          description: `${deps.describeTarget?.(target) ?? 'Target'} could not be loaded from API fallback.`,
          reason: 'unavailable',
        },
      ],
    };
  }

  return {
    entity,
    source: { provider: 'apiFallback', asOf: producedAt },
    actionCount: loadedFromVfs.actionCount + 1,
    gaps: loadedFromVfs.gaps,
  };
}

function allowsDurableEvidence(target: InvestigatorTarget): boolean {
  if (typeof target.allowDurableEvidence === 'boolean') {
    return target.allowDurableEvidence;
  }

  const bounds = target.bounds;
  if (isRecord(bounds) && typeof bounds.allowDurableEvidence === 'boolean') {
    return bounds.allowDurableEvidence;
  }

  return true;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metadataNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function evidenceId(finding: SpecialistFinding, index: number): string {
  const fromMetadata = metadataString(finding.metadata?.id);
  if (fromMetadata) {
    return fromMetadata;
  }

  const normalized = finding.title
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `evidence-${index + 1}`;
}

function durableRefSummary(ref: DurableEvidenceRef): string {
  const details = [
    `path=${ref.path}`,
    ref.revision ? `revision=${ref.revision}` : '',
    ref.workspaceId ? `workspaceId=${ref.workspaceId}` : '',
  ].filter(Boolean);

  return details.join(' ');
}

async function applyDurableEvidence<TEntity>(
  findings: SpecialistFinding[],
  adapter: InvestigatorAdapter<TEntity>,
  deps: InvestigatorDeps,
  target: InvestigatorTarget,
  context?: SpecialistContext,
): Promise<{ findings: SpecialistFinding[]; durableEvidenceCount: number }> {
  const evidenceWriter = deps.evidenceWriter ?? null;
  const threshold = adapter.durableEvidenceThresholdBytes ?? DEFAULT_DURABLE_EVIDENCE_THRESHOLD_BYTES;
  const requestId = readRequestId(target, adapter, context);
  let durableEvidenceCount = 0;

  if (!evidenceWriter) {
    return { findings, durableEvidenceCount };
  }

  if (!allowsDurableEvidence(target)) {
    await evidenceWriter.finalize?.();
    return { findings, durableEvidenceCount };
  }

  const rewritten: SpecialistFinding[] = [];
  for (const [index, finding] of findings.entries()) {
    const body = finding.body ?? '';
    if (byteLength(body) <= threshold) {
      rewritten.push(finding);
      continue;
    }

    const confidence = metadataNumber(finding.metadata?.confidence);
    const writeInput: EvidenceWriteInput = {
      requestId,
      evidenceId: evidenceId(finding, index),
      kind: metadataString(finding.metadata?.kind) ?? 'investigation_evidence',
      title: finding.title,
      content: body,
      contentType: 'text/markdown',
    };
    if (confidence !== undefined) {
      writeInput.confidence = confidence;
    }

    const durableRef = await evidenceWriter.writeEvidence(writeInput);
    durableEvidenceCount += 1;

    rewritten.push({
      ...finding,
      body: `Evidence exceeded ${threshold} bytes and was persisted as durable evidence.\n${durableRefSummary(
        durableRef,
      )}`,
      metadata: {
        ...(finding.metadata ?? {}),
        durableRef,
      },
    });
  }

  await evidenceWriter.finalize?.();

  return { findings: rewritten, durableEvidenceCount };
}

function createFindings<TEntity>(input: {
  adapter: InvestigatorAdapter<TEntity>;
  target: InvestigatorTarget;
  context: SpecialistContext | undefined;
  status: DelegationStatus;
  summary: string;
  findings: SpecialistFinding[];
  confidence?: number;
  metadata: Record<string, unknown>;
}): InvestigatorFindings {
  return {
    requestId: readRequestId(input.target, input.adapter, input.context),
    capability: input.adapter.capability,
    status: input.status,
    summary: input.summary,
    findings: input.findings,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    metadata: {
      specialistName: input.adapter.specialistName,
      specialistVersion: input.adapter.specialistVersion,
      ...input.metadata,
    },
  };
}

function failedFindings<TEntity>(input: {
  adapter: InvestigatorAdapter<TEntity>;
  target: InvestigatorTarget;
  context: SpecialistContext | undefined;
  summary: string;
  gaps: InvestigatorGap[];
  confidence: number;
  metadata: Record<string, unknown>;
}): InvestigatorFindings {
  return createFindings({
    adapter: input.adapter,
    target: input.target,
    context: input.context,
    status: 'failed',
    summary: input.summary,
    findings: [],
    confidence: input.confidence,
    metadata: {
      gaps: input.gaps,
      ...input.metadata,
    },
  });
}

function defaultSummary(
  target: InvestigatorTarget,
  findings: SpecialistFinding[],
  source: InvestigatorEvidenceSource,
  deps: InvestigatorDeps,
): string {
  const label = deps.describeTarget?.(target) ?? readString(target.query) ?? readString(target.instruction) ?? 'Target';
  return `${label} produced ${findings.length} finding(s) from ${source.provider}.`;
}

async function investigate<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  deps: InvestigatorDeps,
  target: InvestigatorTarget,
  context?: SpecialistContext,
): Promise<InvestigatorFindings> {
  const startedAt = deps.now?.() ?? Date.now();
  const producedAt = new Date(startedAt).toISOString();

  try {
    const loaded = await loadEntity(adapter, deps, target, producedAt);
    if (!loaded.entity || !loaded.source) {
      return failedFindings({
        adapter,
        target,
        context,
        summary: `Unable to investigate ${deps.describeTarget?.(target) ?? 'target'}.`,
        gaps: loaded.gaps.length > 0 ? loaded.gaps : [failureGap(target, deps)],
        confidence: 0.2,
        metadata: {
          durationMs: (deps.now?.() ?? Date.now()) - startedAt,
          actionCount: loaded.actionCount,
          durableEvidenceCount: 0,
          producedAt,
        },
      });
    }

    const findings = adapter.toEvidence(loaded.entity, target);
    if (findings.length === 0) {
      return failedFindings({
        adapter,
        target,
        context,
        summary: `Unable to investigate ${deps.describeTarget?.(target) ?? 'target'} because no evidence was produced.`,
        gaps: [
          {
            description: 'Adapter returned no evidence findings.',
            reason: 'unknown',
          },
        ],
        confidence: 0.1,
        metadata: {
          durationMs: (deps.now?.() ?? Date.now()) - startedAt,
          actionCount: loaded.actionCount,
          durableEvidenceCount: 0,
          producedAt,
        },
      });
    }

    const durable = await applyDurableEvidence(findings, adapter, deps, target, context);
    const confidence =
      deps.confidence?.({ target, findings: durable.findings, source: loaded.source }) ??
      Math.min(0.9, 0.6 + durable.findings.length * 0.08);
    const summary =
      deps.summarize?.({ target, findings: durable.findings, source: loaded.source }) ??
      defaultSummary(target, durable.findings, loaded.source, deps);

    return createFindings({
      adapter,
      target,
      context,
      status: 'complete',
      summary,
      findings: durable.findings,
      confidence,
      metadata: {
        gaps: loaded.gaps,
        source: loaded.source,
        durationMs: (deps.now?.() ?? Date.now()) - startedAt,
        actionCount: loaded.actionCount,
        durableEvidenceCount: durable.durableEvidenceCount,
        producedAt,
      },
    });
  } catch (error) {
    return failedFindings({
      adapter,
      target,
      context,
      summary: `Unable to investigate ${deps.describeTarget?.(target) ?? 'target'}.`,
      gaps: [
        {
          description: errorMessage(error),
          reason: 'unknown',
        },
      ],
      confidence: 0.1,
      metadata: {
        durationMs: (deps.now?.() ?? Date.now()) - startedAt,
        actionCount: 1,
        durableEvidenceCount: 0,
        producedAt,
      },
    });
  }
}

function toSpecialistResult<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  findings: InvestigatorFindings,
): SpecialistResult {
  return {
    specialistName: adapter.specialistName,
    output: JSON.stringify(findings, null, 2),
    status: findings.status as SpecialistExecutionStatus,
    ...(findings.confidence === undefined ? {} : { confidence: findings.confidence }),
    metadata: {
      requestId: findings.requestId,
      capability: findings.capability,
      findings,
    },
  };
}

export function createInvestigator<TEntity>(
  adapter: InvestigatorAdapter<TEntity>,
  deps: InvestigatorDeps,
): Specialist {
  return {
    name: adapter.specialistName,
    description: `Investigates a single target using VFS evidence with an optional API fallback.`,
    capabilities: [adapter.capability],
    handler: {
      async execute(instruction, context) {
        const target = parseTarget(instruction, context, adapter, deps);
        if (!target) {
          const failed = failedFindings({
            adapter,
            target: {
              requestId: requestIdFromContext(adapter, context),
              instruction,
            },
            context,
            summary: 'Unable to investigate target because the instruction could not be parsed.',
            gaps: [
              {
                description: 'Expected instruction text or JSON that can be converted to an investigation target.',
                reason: 'invalid_request',
              },
            ],
            confidence: 0.05,
            metadata: {
              actionCount: 0,
              durableEvidenceCount: 0,
              producedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
            },
          });
          return toSpecialistResult(adapter, failed);
        }

        return toSpecialistResult(adapter, await investigate(adapter, deps, target, context));
      },
    },
  };
}
