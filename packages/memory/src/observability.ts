import { createHash } from 'node:crypto';

export type MemoryOpName =
  | 'load'
  | 'save'
  | 'promote'
  | 'compact'
  | 'close'
  | 'init'
  | 'forget';

export interface MemoryOpEvent {
  event: 'memory_op';
  op: MemoryOpName;
  scope?: 'session' | 'user' | 'workspace';
  workspaceId?: string;
  sessionId?: string;
  userId?: string;
  entryCount?: number;
  contentChars?: number;
  status: 'ok' | 'failed';
  error?: string;
  durationMs: number;
}

export function logMemoryOp(event: MemoryOpEvent): void {
  console.info(JSON.stringify(event));
}

export async function measureMemoryOp<T>(
  meta: Omit<MemoryOpEvent, 'event' | 'status' | 'durationMs'>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();

  try {
    const result = await fn();
    logMemoryOp({
      ...meta,
      event: 'memory_op',
      status: 'ok',
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    logMemoryOp({
      ...meta,
      event: 'memory_op',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}

export function hashMemoryContent(content: string): string {
  return createHash('sha256').update(content).digest().subarray(0, 16).toString('base64url');
}
