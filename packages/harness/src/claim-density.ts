export interface EvidenceBudgetInput {
  toolCalls: ReadonlyArray<{
    name: string;
    outputChars: number;
  }>;
  assistantText: string;
}

export interface EvidenceBudgetVerdict {
  exceeds: boolean;
  reason?: 'sparse_tool_evidence_with_structured_claims';
  detail?: { toolCallCount: number; outputChars: number; claimMarkers: string[] };
}

const EVIDENCE_BUDGET_REASON = 'sparse_tool_evidence_with_structured_claims' as const;
const SPARSE_OUTPUT_CHAR_LIMIT = 1024;
const MIN_STRUCTURED_LIST_ITEMS = 3;

const WORKSPACE_ENUMERATION_TOOL_RE = /^(workspace_list|workspace_search)$/;
const SHA_LIKE_RE = /\b[a-f0-9]{6,40}\b/;
const SHORT_OR_ISO_DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;
const OWNER_REPO_RE = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/;
const NUMBERED_ITEM_RE = /^\s*\d+\.\s+/;
const PIPE_PREFIX_RE = /^\s*\|/;
const TABLE_SEPARATOR_RE = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const CLAIM_MARKER_ORDER = ['markdown_table', 'numbered_list', 'sha_like', 'date', 'owner_repo'] as const;

export function exceedsEvidenceBudget(input: EvidenceBudgetInput): EvidenceBudgetVerdict {
  if (input.toolCalls.length !== 1) {
    return { exceeds: false };
  }

  const toolCall = input.toolCalls[0];
  if (!toolCall) {
    return { exceeds: false };
  }

  if (
    !WORKSPACE_ENUMERATION_TOOL_RE.test(toolCall.name)
    || toolCall.outputChars >= SPARSE_OUTPUT_CHAR_LIMIT
  ) {
    return { exceeds: false };
  }

  const claimMarkers = collectClaimMarkers(input.assistantText);
  if (claimMarkers.length === 0) {
    return { exceeds: false };
  }

  return {
    exceeds: true,
    reason: EVIDENCE_BUDGET_REASON,
    detail: {
      toolCallCount: input.toolCalls.length,
      outputChars: toolCall.outputChars,
      claimMarkers,
    },
  };
}

function collectClaimMarkers(text: string): string[] {
  const present = new Set<string>();

  if (containsMarkdownTable(text)) {
    present.add('markdown_table');
  }

  const listMarkers = findStructuredNumberedListMarkers(text);
  for (const marker of listMarkers) {
    present.add(marker);
  }

  return CLAIM_MARKER_ORDER.filter((marker) => present.has(marker));
}

function containsMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let currentRun: string[] = [];

  for (const line of lines) {
    if (PIPE_PREFIX_RE.test(line)) {
      currentRun.push(line);
      continue;
    }

    if (isMarkdownTableRun(currentRun)) {
      return true;
    }
    currentRun = [];
  }

  return isMarkdownTableRun(currentRun);
}

function isMarkdownTableRun(lines: readonly string[]): boolean {
  return lines.length >= 2 && lines.some((line) => TABLE_SEPARATOR_RE.test(line));
}

function findStructuredNumberedListMarkers(text: string): string[] {
  const lines = text.split(/\r?\n/);
  let currentGroup: string[] = [];

  for (const line of lines) {
    if (NUMBERED_ITEM_RE.test(line)) {
      currentGroup.push(line);
      continue;
    }

    const markers = markersForQualifiedNumberedGroup(currentGroup);
    if (markers.length > 0) {
      return markers;
    }
    currentGroup = [];
  }

  return markersForQualifiedNumberedGroup(currentGroup);
}

function markersForQualifiedNumberedGroup(lines: readonly string[]): string[] {
  if (lines.length < MIN_STRUCTURED_LIST_ITEMS) {
    return [];
  }

  let hasShaLike = false;
  let hasDate = false;
  let hasOwnerRepo = false;

  for (const line of lines) {
    const itemMarkers = structuredFieldPresence(line.replace(NUMBERED_ITEM_RE, ''));
    if (!itemMarkers.hasStructuredField) {
      return [];
    }

    hasShaLike ||= itemMarkers.hasShaLike;
    hasDate ||= itemMarkers.hasDate;
    hasOwnerRepo ||= itemMarkers.hasOwnerRepo;
  }

  const markers = ['numbered_list'];
  if (hasShaLike) {
    markers.push('sha_like');
  }
  if (hasDate) {
    markers.push('date');
  }
  if (hasOwnerRepo) {
    markers.push('owner_repo');
  }

  return markers;
}

function structuredFieldPresence(text: string): {
  hasStructuredField: boolean;
  hasShaLike: boolean;
  hasDate: boolean;
  hasOwnerRepo: boolean;
} {
  const hasShaLike = SHA_LIKE_RE.test(text);
  const hasDate = SHORT_OR_ISO_DATE_RE.test(text);
  const hasOwnerRepo = OWNER_REPO_RE.test(text);

  return {
    hasStructuredField: hasShaLike || hasDate || hasOwnerRepo,
    hasShaLike,
    hasDate,
    hasOwnerRepo,
  };
}
