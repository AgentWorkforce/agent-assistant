import { nanoid } from 'nanoid';

export type ProactiveSignalKind =
  | 'slack.presence'
  | 'slack.status'
  | 'github.pr_closed'
  | 'github.pr_review_submitted';

export interface ProactiveSignal {
  id: string;
  kind: ProactiveSignalKind;
  workspaceId: string;
  subjectId: string;
  payload: Record<string, unknown>;
  receivedAt: number;
  expiresAt: number;
}

export const DEFAULT_TTL_MS_BY_KIND: Record<ProactiveSignalKind, number> = {
  'slack.presence': 10 * 60 * 1000,
  'slack.status': 30 * 60 * 1000,
  'github.pr_closed': 48 * 60 * 60 * 1000,
  'github.pr_review_submitted': 24 * 60 * 60 * 1000,
};

export interface SignalInboxStore {
  put(signal: ProactiveSignal): Promise<void>;
  list(workspaceId: string): Promise<ProactiveSignal[]>;
  delete(workspaceId: string, signalId: string): Promise<void>;
}

export interface RecordSignalInput {
  kind: ProactiveSignalKind;
  workspaceId: string;
  subjectId: string;
  payload?: Record<string, unknown>;
  now?: number;
  ttlMs?: number;
}

export interface DrainOptions {
  kind?: ProactiveSignalKind | ProactiveSignalKind[];
  now?: number;
  autoDeleteExpired?: boolean;
}

export async function recordSignal(
  store: SignalInboxStore,
  input: RecordSignalInput,
): Promise<ProactiveSignal> {
  const receivedAt = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS_BY_KIND[input.kind];
  const signal: ProactiveSignal = {
    id: nanoid(),
    kind: input.kind,
    workspaceId: input.workspaceId,
    subjectId: input.subjectId,
    payload: input.payload ?? {},
    receivedAt,
    expiresAt: receivedAt + ttlMs,
  };

  await store.put(signal);
  return signal;
}

export async function drainSignals(
  store: SignalInboxStore,
  workspaceId: string,
  options?: DrainOptions,
): Promise<ProactiveSignal[]> {
  const now = options?.now ?? Date.now();
  const autoDeleteExpired = options?.autoDeleteExpired ?? true;
  const kindFilter = createKindFilter(options?.kind);
  const signals = await store.list(workspaceId);
  const activeSignals: ProactiveSignal[] = [];

  for (const signal of signals) {
    if (signal.expiresAt <= now) {
      if (autoDeleteExpired) {
        try {
          await store.delete(workspaceId, signal.id);
        } catch {
          // Expiry cleanup is best-effort; callers still receive valid active signals.
        }
      }
      continue;
    }

    if (!kindFilter || kindFilter.has(signal.kind)) {
      activeSignals.push(signal);
    }
  }

  return activeSignals;
}

export async function clearSignal(
  store: SignalInboxStore,
  workspaceId: string,
  signalId: string,
): Promise<void> {
  await store.delete(workspaceId, signalId);
}

function createKindFilter(
  kind: ProactiveSignalKind | ProactiveSignalKind[] | undefined,
): Set<ProactiveSignalKind> | null {
  if (kind === undefined) {
    return null;
  }

  if (Array.isArray(kind)) {
    return new Set(kind);
  }

  return new Set([kind]);
}
