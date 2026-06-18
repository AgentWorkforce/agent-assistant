import type { VfsEntry, VfsListOptions, VfsProvider, VfsReadResult, VfsSearchOptions, VfsSearchResult } from '@agent-assistant/vfs';

// ─── Minimal GCS interface ────────────────────────────────────────────────────
// Accepts real @google-cloud/storage Bucket/File objects without importing the SDK.

export interface GcsFileLike {
  readonly name: string;
  exists(): Promise<[boolean]>;
  download(): Promise<[Buffer]>;
  save(content: string | Buffer, options?: { contentType?: string }): Promise<void>;
  delete(): Promise<void>;
}

export interface GcsBucketLike {
  file(path: string): GcsFileLike;
  getFiles(options?: {
    prefix?: string;
    delimiter?: string;
    maxResults?: number;
  }): Promise<[GcsFileLike[]]>;
}

export interface GcpStorageVfsProviderOptions {
  bucket: GcsBucketLike;
  /** Object key prefix for all operations — namespaces the VFS within the bucket. */
  prefix?: string;
}

/**
 * VfsProvider backed by Google Cloud Storage.
 *
 * Each GCS object is a VFS file entry. Directory entries are inferred from
 * object key prefixes. The `search` method performs an in-memory grep across
 * matched objects — for high-cardinality buckets, wire a dedicated search
 * index (e.g. Vertex AI Search) instead.
 */
export class GcpStorageVfsProvider implements VfsProvider {
  private readonly bucket: GcsBucketLike;
  private readonly prefix: string;

  constructor(options: GcpStorageVfsProviderOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ? `${options.prefix.replace(/\/$/, '')}/` : '';
  }

  async list(path: string, options?: VfsListOptions): Promise<VfsEntry[]> {
    const gcsPrefix = this.resolve(path ? `${path}/` : '');
    const [files] = await this.bucket.getFiles({
      prefix: gcsPrefix,
      maxResults: options?.limit,
    });

    return files.map((f) => ({
      path: this.strip(f.name),
      type: f.name.endsWith('/') ? ('dir' as const) : ('file' as const),
      provider: 'gcp-storage',
    }));
  }

  async read(path: string): Promise<VfsReadResult | null> {
    const file = this.bucket.file(this.resolve(path));
    const [exists] = await file.exists();
    if (!exists) return null;

    const [buf] = await file.download();
    return {
      path,
      content: buf.toString('utf-8'),
      contentType: 'text/plain',
      encoding: 'utf-8',
      provider: 'gcp-storage',
    };
  }

  async search(query: string, options?: VfsSearchOptions): Promise<VfsSearchResult[]> {
    const [files] = await this.bucket.getFiles({ prefix: this.prefix });
    const regex = new RegExp(query);
    const results: VfsSearchResult[] = [];
    const limit = options?.limit ?? Infinity;

    for (const file of files) {
      if (results.length >= limit) break;
      try {
        const [buf] = await file.download();
        const text = buf.toString('utf-8');
        const matchLine = text.split('\n').find((l) => regex.test(l));
        if (matchLine !== undefined) {
          results.push({
            path: this.strip(file.name),
            type: 'file',
            snippet: matchLine,
            provider: 'gcp-storage',
          });
        }
      } catch {
        // Skip unreadable objects (binary, oversized, permissions).
      }
    }

    return results;
  }

  async stat(path: string): Promise<VfsEntry | null> {
    const file = this.bucket.file(this.resolve(path));
    const [exists] = await file.exists();
    if (!exists) return null;
    return { path, type: 'file', provider: 'gcp-storage' };
  }

  private resolve(path: string): string {
    return `${this.prefix}${path}`.replace(/\/+/g, '/').replace(/^\//, '');
  }

  private strip(gcspath: string): string {
    const stripped = gcspath.startsWith(this.prefix)
      ? gcspath.slice(this.prefix.length)
      : gcspath;
    return stripped.startsWith('/') ? stripped.slice(1) : stripped;
  }
}
