export type LinearEnumerationCapability = 'linear.enumerate';
export type LinearEntityType = 'issue' | 'project' | 'comment';

export interface LinearQueryFilterSet {
  state?: string[];
  team?: string[];
  assignee?: string[];
  priority?: string[];
  project?: string[];
  type?: LinearEntityType[];
  [filter: string]: string[] | undefined;
}

export interface LinearEnumerationParams {
  capability: LinearEnumerationCapability;
  query?: string;
  filters?: LinearQueryFilterSet;
  cursor?: string;
  limit?: number;
}
