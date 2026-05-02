export interface ClaimEvidence {
  /** Specialist requestId or any opaque-but-unique evidence id. */
  id: string;
  /** Optional kind for telemetry. */
  kind?: string;
  /** Optional source url / vfs path. */
  source?: string;
}

export interface PostWithEvidenceInput {
  channel: string;
  threadTs?: string;
  text: string;
  evidence: ReadonlyArray<ClaimEvidence>;
}

export interface PostWithEvidenceResult {
  posted: boolean;
  blockedReason?: 'no_evidence' | 'egress_failed';
  /** When posted, the underlying egress's return value. */
  egressResult?: unknown;
  /** Detected claim markers (for telemetry). */
  detectedMarkers?: string[];
}

export interface ProactiveEgress {
  postMessageChunked(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<unknown>;
}

export interface PostWithEvidenceOptions {
  egress: ProactiveEgress;
  onEvent?: (event: {
    event: string;
    channel: string;
    reason?: string;
    markers?: string[];
  }) => void;
  /**
   * Default false. When true, the evidence precondition is skipped and the
   * post is forwarded to `egress` even if claim markers were detected with no
   * evidence attached.
   *
   * Reserved for two callers ONLY:
   *   1. Tests in this package (and downstream packages) that need to
   *      exercise the success path without constructing real evidence.
   *   2. A deliberate operator override at a known-safe call site where the
   *      caller has independently verified that the text contains no
   *      external-fact claims (e.g. a hand-authored ops broadcast). The
   *      override MUST be accompanied by a code comment explaining why the
   *      precondition is safe to skip at that site.
   *
   * Do not flip this on globally to "fix" false positives — false positives
   * are by design (spec §6: missing a pattern lets fabrications through,
   * blocking a benign post is recoverable).
   */
  bypassEvidenceCheck?: boolean;
}

const CLAIM_MARKER_PATTERNS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
}> = [
  {
    name: 'pr_ref',
    pattern: /\b(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d{1,6}\b/g,
  },
  {
    name: 'github_url',
    pattern: /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g,
  },
  {
    name: 'linear_ref',
    pattern: /\b[A-Z]{2,5}-\d+\b/g,
  },
  {
    name: 'sha_ref',
    pattern: /\b[a-f0-9]{7,40}\b/g,
  },
  {
    name: 'sync_status',
    pattern:
      /\b(?:is|isn't|is not|are|aren't|are not)\s+(?:already\s+)?(?:synced|indexed|cloned)\b/gi,
  },
  {
    name: 'merged_status',
    pattern: /\b(?:was\s+)?merged\s+(?:at|on|in)\b/gi,
  },
  {
    name: 'open_duration',
    pattern: /\bopen\s+(?:since|for)\s+\b/gi,
  },
];

function findMatches(text: string, pattern: RegExp): string[] {
  const matches = text.match(new RegExp(pattern.source, pattern.flags));
  return matches ?? [];
}

function detectClaimMarkers(text: string): string[] {
  const markers: string[] = [];
  const seen = new Set<string>();

  for (const { name, pattern } of CLAIM_MARKER_PATTERNS) {
    if (findMatches(text, pattern).length === 0 || seen.has(name)) {
      continue;
    }

    seen.add(name);
    markers.push(name);
  }

  return markers;
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return 'Unknown egress error';
}

export async function postWithEvidence(
  input: PostWithEvidenceInput,
  opts: PostWithEvidenceOptions,
): Promise<PostWithEvidenceResult> {
  const detectedMarkers = detectClaimMarkers(input.text);
  const hasDetectedClaims = detectedMarkers.length > 0;
  const hasEvidence = input.evidence.length > 0;
  const shouldBypass = opts.bypassEvidenceCheck === true;
  const shouldBlock = hasDetectedClaims && !hasEvidence && !shouldBypass;

  if (shouldBlock) {
    opts.onEvent?.({
      event: 'proactive_post_blocked_no_evidence',
      channel: input.channel,
      markers: detectedMarkers,
    });
    return {
      posted: false,
      blockedReason: 'no_evidence',
      detectedMarkers,
    };
  }

  try {
    const egressResult = await opts.egress.postMessageChunked(
      input.channel,
      input.text,
      input.threadTs,
    );
    return {
      posted: true,
      egressResult,
      detectedMarkers,
    };
  } catch (error) {
    opts.onEvent?.({
      event: 'proactive_post_egress_failed',
      channel: input.channel,
      reason: errorReason(error),
    });
    return {
      posted: false,
      blockedReason: 'egress_failed',
    };
  }
}
