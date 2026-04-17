export type VfsNodeType = 'file' | 'dir' | 'unknown';

export interface VfsEntry {
  path: string;
  type: VfsNodeType;
  provider?: string;
  title?: string;
  revision?: string;
  updatedAt?: string;
  size?: number;
  properties?: Record<string, string>;
}

export interface VfsSearchResult extends VfsEntry {
  snippet?: string;
}

export interface VfsReadResult {
  path: string;
  content: string;
  contentType?: string;
  encoding?: 'utf-8' | 'base64';
  provider?: string;
  title?: string;
  revision?: string;
  updatedAt?: string;
  properties?: Record<string, string>;
}

export interface VfsListOptions {
  depth?: number;
  limit?: number;
}

export interface VfsSearchOptions {
  provider?: string;
  limit?: number;
}

export interface VfsProvider {
  list(path: string, options?: VfsListOptions): Promise<VfsEntry[]>;
  read(path: string): Promise<VfsReadResult | null>;
  search(query: string, options?: VfsSearchOptions): Promise<VfsSearchResult[]>;
  stat?(path: string): Promise<VfsEntry | null>;
}

export interface VfsCliWritable {
  write(chunk: string): unknown;
}

export interface VfsCliOptions {
  provider: VfsProvider;
  argv?: string[];
  name?: string;
  stdout?: VfsCliWritable;
  stderr?: VfsCliWritable;
  maxContentChars?: number;
  maxResults?: number;
}
