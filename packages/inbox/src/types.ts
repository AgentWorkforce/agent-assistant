import type {
  TurnEnrichmentCandidate,
  TurnMemoryCandidate,
} from '@agent-assistant/turn-context';

export type InboxItemKind =
  | 'imported_chat'
  | 'forwarded_message'
  | 'external_transcript'
  | 'trusted_memo'
  | 'other';

export type InboxItemStatus =
  | 'pending'
  | 'acknowledged'
  | 'projected'
  | 'dismissed'
  | 'expired';

export interface InboxSourceTrust {
  sourceId: string;
  sourceLabel?: string;
  trustLevel: 'verified' | 'trusted' | 'unverified';
  actorId?: string;
  actorLabel?: string;
  producedAt?: string;
}

export interface InboxItemScope {
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  threadId?: string;
}

export interface InboxItem {
  id: string;
  assistantId: string;
  kind: InboxItemKind;
  status: InboxItemStatus;
  source: InboxSourceTrust;
  content: string;
  structured?: Record<string, unknown>;
  title?: string;
  tags?: string[];
  scope?: InboxItemScope;
  receivedAt: string;
  expiresAt?: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface InboxWriteInput {
  assistantId: string;
  kind: InboxItemKind;
  source: InboxSourceTrust;
  content: string;
  structured?: Record<string, unknown>;
  title?: string;
  tags?: string[];
  scope?: InboxItemScope;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface InboxListQuery {
  assistantId: string;
  status?: InboxItemStatus | InboxItemStatus[];
  kind?: InboxItemKind | InboxItemKind[];
  since?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface InboxStore {
  write(input: InboxWriteInput): Promise<InboxItem>;
  get(itemId: string): Promise<InboxItem | null>;
  list(query: InboxListQuery): Promise<InboxItem[]>;
  acknowledge(itemId: string): Promise<InboxItem>;
  dismiss(itemId: string): Promise<InboxItem>;
  updateStatus(itemId: string, status: InboxItemStatus): Promise<InboxItem>;
}

export interface InboxStoreAdapter {
  insert(item: InboxItem): Promise<InboxItem>;
  fetchById(itemId: string): Promise<InboxItem | null>;
  fetchMany(query: InboxAdapterQuery): Promise<InboxItem[]>;
  update(itemId: string, patch: Partial<InboxItem>): Promise<InboxItem>;
}

export interface InboxAdapterQuery {
  assistantId: string;
  statuses?: InboxItemStatus[];
  kinds?: InboxItemKind[];
  since?: string;
  excludeExpiredBefore: string;
  limit: number;
  order: 'newest' | 'oldest';
}

export interface InboxStoreConfig {
  adapter: InboxStoreAdapter;
}

export interface InboxToMemoryProjector {
  project(item: InboxItem): TurnMemoryCandidate | null;
}

export interface InboxToEnrichmentProjector {
  project(item: InboxItem): TurnEnrichmentCandidate | null;
}

export class InboxItemNotFoundError extends Error {
  constructor(public readonly itemId: string) {
    super(`Inbox item not found: ${itemId}`);
    this.name = 'InboxItemNotFoundError';
  }
}

export class InboxInvalidStatusTransitionError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly from: InboxItemStatus,
    public readonly to: InboxItemStatus,
  ) {
    super(`Invalid inbox status transition for "${itemId}": ${from} -> ${to}`);
    this.name = 'InboxInvalidStatusTransitionError';
  }
}

export class InboxRelayNativeSourceError extends Error {
  constructor(
    public readonly assistantId: string,
    public readonly sourceId: string,
  ) {
    super(
      `Inbox source "${sourceId}" matches assistant identity "${assistantId}" and must remain outside the inbox boundary.`,
    );
    this.name = 'InboxRelayNativeSourceError';
  }
}
