import type { VfsEntry, VfsListOptions, VfsProvider, VfsReadResult, VfsSearchOptions, VfsSearchResult } from '@agent-assistant/vfs';

export interface CloudflareShellLike {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  grep(
    pattern: string,
    options?: { path?: string; maxResults?: number },
  ): Promise<Array<{ path: string; content: string; lineNumber?: number }>>;
}

export interface CfShellVfsProviderOptions {
  shell: CloudflareShellLike;
  /** Path prefix prepended to every shell operation. Useful for namespacing by workspace. */
  prefix?: string;
}

export class CfShellVfsProvider implements VfsProvider {
  private readonly shell: CloudflareShellLike;
  private readonly prefix: string;

  constructor(options: CfShellVfsProviderOptions) {
    this.shell = options.shell;
    this.prefix = options.prefix ?? '';
  }

  async list(path: string, options?: VfsListOptions): Promise<VfsEntry[]> {
    const fullPath = this.resolve(path);
    const paths = await this.shell.list(fullPath);
    const entries: VfsEntry[] = paths.map((p) => ({
      path: this.strip(p),
      type: p.endsWith('/') ? ('dir' as const) : ('file' as const),
      provider: 'cf-shell',
    }));

    const limit = options?.limit;
    return limit != null ? entries.slice(0, limit) : entries;
  }

  async read(path: string): Promise<VfsReadResult | null> {
    const content = await this.shell.read(this.resolve(path));
    if (content === null) return null;
    return {
      path,
      content,
      contentType: 'text/plain',
      encoding: 'utf-8',
      provider: 'cf-shell',
    };
  }

  async search(query: string, options?: VfsSearchOptions): Promise<VfsSearchResult[]> {
    const results = await this.shell.grep(query, {
      path: this.prefix || undefined,
      maxResults: options?.limit,
    });
    return results.map((r) => ({
      path: this.strip(r.path),
      type: 'file' as const,
      snippet: r.content,
      provider: 'cf-shell',
    }));
  }

  async stat(path: string): Promise<VfsEntry | null> {
    const content = await this.shell.read(this.resolve(path));
    if (content === null) return null;
    return { path, type: 'file', provider: 'cf-shell' };
  }

  private resolve(path: string): string {
    if (!this.prefix) return path;
    return `${this.prefix}/${path}`.replace(/\/+/g, '/');
  }

  private strip(path: string): string {
    if (!this.prefix) return path;
    const stripped = path.startsWith(this.prefix) ? path.slice(this.prefix.length) : path;
    return stripped.startsWith('/') ? stripped.slice(1) : stripped;
  }
}
