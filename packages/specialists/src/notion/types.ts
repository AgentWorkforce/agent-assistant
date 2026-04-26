export type NotionEnumerationCapability = 'notion.enumerate';
export type NotionSearchProvider = 'notion';
export type NotionEntityType = 'page' | 'database' | 'block' | 'comment';
export type NotionFilterKey =
  | 'type'
  | 'database'
  | 'title'
  | 'tag'
  | 'author'
  | 'updated_window';

export interface NotionQueryFilterSet {
  type?: NotionEntityType[];
  database?: string[];
  title?: string[];
  tag?: string[];
  author?: string[];
  updated_window?: string[];
  [filter: string]: string[] | undefined;
}

export interface NotionEnumerationParams {
  capability: NotionEnumerationCapability;
  query?: string;
  filters?: NotionQueryFilterSet;
  cursor?: string;
  limit?: number;
}
