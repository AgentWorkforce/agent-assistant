export type GitHubInvestigationCapability = 'pr_investigation' | 'github.investigate';
export type GitHubCapability = GitHubInvestigationCapability | 'github.enumerate';
export type GitHubSearchType = 'pr' | 'issue';
export type GitHubSearchState = 'open' | 'closed';

export interface GitHubQueryFilterSet {
  repo?: string[];
  label?: string[];
  type?: GitHubSearchType[];
  state?: GitHubSearchState[];
  [filter: string]: string[] | undefined;
}

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubInvestigationParams {
  capability: GitHubInvestigationCapability;
  query: string;
  filters?: GitHubQueryFilterSet;
  limit?: number;
  pr?: GitHubPullRequestRef;
}

export interface GitHubEnumerationParams {
  capability: 'github.enumerate';
  query?: string;
  filters?: GitHubQueryFilterSet;
  cursor?: string;
  limit?: number;
}

export type GitHubCapabilityParams = GitHubInvestigationParams | GitHubEnumerationParams;
