export interface CloneRequestPayload {
  workspaceId: string;
  owner: string;
  repo: string;
  ref: string; // e.g. 'refs/heads/main'
  // Nango connection id. Optional — if omitted, the cloud clone-request
  // route derives it from the workspace's GitHub integration row in
  // workspaceIntegrations. Cloud-side derivation is the authoritative
  // path; consumers shouldn't need to plumb connectionIds across repos.
  connectionId?: string;
}

export type CloneJobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface CloneJobStatus {
  jobId: string;
  state: CloneJobState;
  queuedAt?: string; // ISO
  startedAt?: string; // ISO
  completedAt?: string; // ISO
  headSha?: string;
  errorMessage?: string;
  cloneSource?: string;
}

export interface CloneSentinel {
  jobId: string;
  headSha: string;
  defaultBranch: string;
  clonedAt: string; // ISO
  filesWritten: number;
  cloneSource: string;
}

export type CloneAdvisoryNotice =
  | 'clone_requested'
  | 'clone_in_progress'
  | 'clone_failed';

export interface CloneAdvisory {
  notice: CloneAdvisoryNotice;
  cloneState: CloneJobState | 'unknown';
  cloneJobId?: string;
  cloneStartedAt?: string;
  reason?: string; // populated for clone_failed
}
