import type {
  HarnessToolEvidenceClarification,
  HarnessToolEvidenceClarificationHook,
  HarnessToolEvidenceClarificationReason,
  HarnessToolResult,
} from './types.js';

export interface ToolEvidenceClarificationOptions {
  emptyResultKeys?: readonly string[];
  questionForReason?: Partial<Record<HarnessToolEvidenceClarificationReason, string>>;
  /**
   * Tool names that should NEVER trigger an evidence-based clarification.
   * Useful for read-only / "expected to sometimes be empty" tools like
   * memory_recall where empty results are normal, not a signal that the
   * model needs to ask the user a clarifying question.
   *
   * Note: explicit clarification hints on the tool result itself
   * (result.metadata.clarification or structuredOutput.clarification)
   * are still respected — the exclusion only suppresses the implicit
   * classifier path.
   */
  excludeToolNames?: readonly string[];
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

export function createToolEvidenceClarificationHook(
  options: ToolEvidenceClarificationOptions = {},
): HarnessToolEvidenceClarificationHook {
  return (result) => detectToolEvidenceClarification(result, options);
}

export function detectToolEvidenceClarification(
  result: HarnessToolResult,
  options: ToolEvidenceClarificationOptions = {},
): HarnessToolEvidenceClarification | null {
  // Retry-exhausted short-circuit. When a tool returns
  // `status: 'error'` with `retryable: true`, the harness has already run
  // its in-turn retry loop (`executeToolWithRetry`) and given up — the
  // final `lastResult` is what we see here. The `retryable` flag describes
  // IN-TURN retry potential, which is moot post-retry-loop. Asking the
  // user "what should I retry with?" misleads them: it implies the model
  // can change the input and recover, but the call already failed N times
  // with the same input the user gave. This MUST run before the explicit
  // clarification path because tool authors sometimes attach a
  // `transient_provider_error` clarification hint to retryable failures
  // (e.g. sage's `buildTransientClarification`) which produces exactly
  // the misleading "retry with what?" UX.
  //
  // Non-retryable explicit hints (e.g. `auth_failed` with no `retryable`
  // flag, where the hint asks a real question like "which org?") are
  // still honored below — those are deliberate clarifications, not
  // retry-loop fallout.
  if (result.status === 'error' && result.error?.retryable === true) {
    return null;
  }

  const explicit = readExplicitClarification(result);
  if (explicit) {
    return explicit;
  }

  // Failed-tool short-circuit (non-retryable case). Implicit clarification
  // classifiers (empty results / ambiguous identifiers) inspect tool
  // result *content* — but a failed tool's result frequently looks empty
  // or thin, which would fire these classifiers even though the right
  // action is to surface the failure, not ask the user a clarifying
  // question.
  //
  // This is independent of `excludeToolNames`: that option excludes a
  // specific tool by name; this short-circuit excludes ANY tool that
  // errored. Both can coexist. Explicit clarification hints on
  // metadata/structuredOutput are still respected (handled above) — only
  // the implicit classifier path is suppressed for failed tools.
  if (result.status === 'error') {
    return null;
  }

  const excludedToolNames = options.excludeToolNames ? new Set(options.excludeToolNames) : null;
  if (excludedToolNames?.has(result.toolName)) {
    return null;
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
