declare module '@agent-assistant/vfs' {
  export interface VfsEntry {
    path: string;
    type: 'file' | 'dir' | 'unknown';
    provider?: string;
    title?: string;
    revision?: string;
    updatedAt?: string;
    size?: number;
    properties?: Record<string, string>;
  }
}
