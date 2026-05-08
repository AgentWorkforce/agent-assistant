export { runVfsCli } from './cli.js';
export { readInsightEnvelope } from './insight/index.js';
export {
  basename,
  dirname,
  formatEntries,
  formatEntry,
  formatReadResult,
  formatSearchResults,
  formatTree,
  normalizeVfsPath,
  toJson,
  truncateReadResult,
} from './output.js';

export type {
  VfsCliOptions,
  VfsCliWritable,
  VfsEntry,
  VfsListOptions,
  VfsNodeType,
  VfsProvider,
  VfsReadResult,
  VfsSearchOptions,
  VfsSearchResult,
} from './types.js';
export type {
  InsightEnvelope,
  InsightFreshness,
  InsightReadResult,
  VirtualFileSystem,
} from './insight/index.js';
export type { TruncatedReadResult } from './output.js';
// Clone primitives — see './clone' subpath for the focused submodule.
export type {
  CloneRequestPayload,
  CloneJobState,
  CloneJobStatus,
  CloneSentinel,
  CloneAdvisory,
  CloneAdvisoryNotice,
} from './clone/types.js';
