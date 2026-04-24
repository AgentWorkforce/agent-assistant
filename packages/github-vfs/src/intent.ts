import type { GitHubRepoRef } from './queries.js';

const REPO_TOKEN_PATTERN = '([A-Za-z0-9_.-]+)\\/([A-Za-z0-9_.-]+)';

function hasPromptInjectionGuard(text: string): boolean {
  return (
    /\bignore\b[\s\S]*\binstructions?\b/i.test(text) ||
    /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?\b/i.test(
      text,
    )
  );
}

function hasContentFilterPredicate(text: string): boolean {
  if (/\b(?:that|with|touching|about|containing)\b/i.test(text)) {
    return true;
  }

  const forPathThenRepo = new RegExp(
    `\\bfor\\s+(?:\\.?\\.?\\/)?[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.\\/-]+[\\s,;]+(?:in|from|on|repo:)\\s+${REPO_TOKEN_PATTERN}\\b`,
    'i',
  );
  if (forPathThenRepo.test(text)) {
    return true;
  }

  const forNestedPath = /\bfor\s+(?:\.?\.?\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+\b/i;
  return forNestedPath.test(text);
}

export function parseGitHubRepoRefFromText(text: string): GitHubRepoRef | null {
  const explicit = /\brepo:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/i.exec(text);
  const match = explicit ?? /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/.exec(text);
  if (!match) return null;
  return { owner: match[1] ?? '', repo: match[2] ?? '' };
}

export function detectOpenPrListIntent(text: string): GitHubRepoRef | null {
  if (hasPromptInjectionGuard(text)) {
    return null;
  }
  if (!/\b(?:list|show|which|what)\b/i.test(text)) return null;
  if (!/\bopen\b/i.test(text)) return null;
  if (!/\b(?:prs?|pull requests?)\b/i.test(text)) return null;
  if (
    /\b(?:risk|investigat(?:e|ion)|analy[sz]e|review|summari[sz]e|why|root cause|plan)\b/i.test(
      text,
    )
  ) {
    return null;
  }
  if (hasContentFilterPredicate(text)) {
    return null;
  }

  return parseGitHubRepoRefFromText(text);
}
