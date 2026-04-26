import type {
  HarnessToolEvidenceClarification,
  HarnessToolEvidenceClarificationHook,
  HarnessToolEvidenceClarificationReason,
  HarnessToolResult,
} from './types.js';

export interface ToolEvidenceClarificationOptions {
  emptyResultKeys?: readonly string[];
  questionForReason?: Partial<Record<HarnessToolEvidenceClarificationReason, string>>;
}

const DEFAULT_EMPTY_RESULT_KEYS = [
  'results',
  'items',
  'matches',
  'entries',
  'records',
  'data',
];

const AMBIGUOUS_RESULT_KEYS = ['candidates', 'possibleMatches', 'ambiguousMatches'];

const TRANSIENT_ERROR_CODES = new Set([
  'provider_timeout',
  'timeout',
  'rate_limited',
  'rate_limit',
  'temporarily_unavailable',
  'provider_unavailable',
  'network_error',
]);

export function createToolEvidenceClarificationHook(
  options: ToolEvidenceClarificationOptions = {},
): HarnessToolEvidenceClarificationHook {
  return (result) => detectToolEvidenceClarification(result, options);
}

export function detectToolEvidenceClarification(
  result: HarnessToolResult,
  options: ToolEvidenceClarificationOptions = {},
): HarnessToolEvidenceClarification | null {
  const explicit = readExplicitClarification(result);
  if (explicit) {
    return explicit;
  }

  const reason = classifyToolEvidence(result, options);
  if (!reason) {
    return null;
  }

  return {
    reason,
    question: questionFor(result, reason, options),
    metadata: { toolName: result.toolName, callId: result.callId },
  };
}

function classifyToolEvidence(
  result: HarnessToolResult,
  options: ToolEvidenceClarificationOptions,
): HarnessToolEvidenceClarificationReason | null {
  if (hasAmbiguousEvidence(result)) {
    return 'ambiguous_identifier';
  }

  if (hasEmptyResultEvidence(result, options)) {
    return 'empty_results';
  }

  if (hasTransientProviderEvidence(result)) {
    return 'transient_provider_error';
  }

  return null;
}

function hasEmptyResultEvidence(
  result: HarnessToolResult,
  options: ToolEvidenceClarificationOptions,
): boolean {
  if (result.status !== 'success') {
    return false;
  }

  const structured = result.structuredOutput;
  if (structured) {
    if (structured.empty === true || structured.resultCount === 0 || structured.total === 0) {
      return true;
    }

    const keys = options.emptyResultKeys ?? DEFAULT_EMPTY_RESULT_KEYS;
    if (keys.some((key) => Array.isArray(structured[key]) && structured[key].length === 0)) {
      return true;
    }
  }

  const output = result.output?.trim();
  if (!output) {
    return false;
  }

  return /\b(no|zero)\s+(results?|matches?|items?|records?)\b/i.test(output);
}

function hasAmbiguousEvidence(result: HarnessToolResult): boolean {
  const structured = result.structuredOutput;
  if (structured) {
    if (structured.ambiguous === true) {
      return true;
    }

    if (
      AMBIGUOUS_RESULT_KEYS.some(
        (key) => Array.isArray(structured[key]) && structured[key].length > 1,
      )
    ) {
      return true;
    }
  }

  return /\b(ambiguous|multiple\s+(matches?|results?|candidates?)|more than one)\b/i.test(
    result.output ?? '',
  );
}

function hasTransientProviderEvidence(result: HarnessToolResult): boolean {
  if (result.status !== 'error') {
    return false;
  }

  if (result.error?.retryable === true) {
    return true;
  }

  const code = result.error?.code?.toLowerCase();
  return code ? TRANSIENT_ERROR_CODES.has(code) : false;
}

function readExplicitClarification(
  result: HarnessToolResult,
): HarnessToolEvidenceClarification | null {
  return (
    readClarificationValue(result.metadata?.clarification, result) ??
    readClarificationValue(result.metadata?.clarificationHint, result) ??
    readClarificationValue(result.structuredOutput?.clarification, result) ??
    readClarificationValue(result.structuredOutput?.clarificationHint, result)
  );
}

function readClarificationValue(
  value: unknown,
  result: HarnessToolResult,
): HarnessToolEvidenceClarification | null {
  if (typeof value === 'string') {
    const question = value.trim();
    return question ? { question, reason: 'custom', metadata: { toolName: result.toolName } } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const question = readString(value.question);
  if (!question) {
    return null;
  }

  return {
    question,
    reason: readReason(value.reason),
    metadata: isRecord(value.metadata) ? value.metadata : { toolName: result.toolName },
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readReason(value: unknown): HarnessToolEvidenceClarificationReason {
  switch (value) {
    case 'empty_results':
    case 'ambiguous_identifier':
    case 'transient_provider_error':
    case 'custom':
      return value;
    default:
      return 'custom';
  }
}

function questionFor(
  result: HarnessToolResult,
  reason: HarnessToolEvidenceClarificationReason,
  options: ToolEvidenceClarificationOptions,
): string {
  const configured = options.questionForReason?.[reason];
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  switch (reason) {
    case 'ambiguous_identifier':
      return `I found multiple possible matches in ${result.toolName}. Which exact identifier should I use?`;
    case 'transient_provider_error':
      return `The ${result.toolName} lookup hit a transient provider error. What exact identifier or narrower filter should I retry with?`;
    case 'empty_results':
      return `I could not find a match with the current ${result.toolName} query. What exact identifier, name, or narrower filter should I use?`;
    case 'custom':
      return `What exact identifier or narrower filter should I use for ${result.toolName}?`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
