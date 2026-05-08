import type { EvalResult } from './eval-runner.js';

const MAX_PR_COMMENT_BYTES = 4 * 1024;
const textEncoder = new TextEncoder();

function compareResults(left: EvalResult, right: EvalResult): number {
  if (left.passed !== right.passed) {
    return left.passed ? 1 : -1;
  }

  return left.name.localeCompare(right.name, 'en');
}

function formatMoney(cost: number | undefined): string {
  return `$${(cost ?? 0).toFixed(4)}`;
}

function formatScore(total: number): string {
  return total.toFixed(2);
}

function formatPassLine(result: EvalResult): string {
  return `- PASS \`${result.name}\` | score ${formatScore(result.score.total)} | tools ${result.budget.toolCalls} | latency ${result.budget.latencyMs}ms | cost ${formatMoney(result.budget.cost)}`;
}

function formatFailureDetails(result: EvalResult): string {
  const parts: string[] = [];

  if (result.evidence.missing.length > 0) {
    parts.push(`missing evidence: ${result.evidence.missing.join(', ')}`);
  }
  if (result.forbiddenFanoutViolations.length > 0) {
    parts.push(`forbidden fanout: ${result.forbiddenFanoutViolations.join('; ')}`);
  }
  if (result.finalOutputCleanResult.clean === false) {
    parts.push(
      `sanitized output: ${result.finalOutputCleanResult.sanitizedKinds.join(', ') || 'unknown'}`,
    );
  }
  const failedComponents = Object.entries(result.score.components)
    .filter(([, value]) => value === 0)
    .map(([key]) => key);
  if (failedComponents.length > 0) {
    parts.push(`failed checks: ${failedComponents.join(', ')}`);
  }

  return parts.join(' | ');
}

function formatFailureBlock(result: EvalResult): string {
  return [
    '<details>',
    `<summary>FAIL \`${result.name}\` | score ${formatScore(result.score.total)} | tools ${result.budget.toolCalls} | latency ${result.budget.latencyMs}ms | cost ${formatMoney(result.budget.cost)}</summary>`,
    '',
    formatFailureDetails(result),
    '',
    '</details>',
  ].join('\n');
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function joinSections(sections: readonly string[]): string {
  return sections.filter((section) => section.length > 0).join('\n');
}

export function formatPrCommentSummary(results: EvalResult[]): string {
  const ordered = [...results].sort(compareResults);
  const passedCount = ordered.filter((result) => result.passed).length;
  const failedCount = ordered.length - passedCount;
  const header = [
    '## Eval Summary',
    '',
    `- ${passedCount}/${ordered.length} passed`,
    `- ${failedCount} failed`,
    '',
  ].join('\n');
  const sections = [header];

  for (const result of ordered) {
    const nextSection = result.passed ? formatPassLine(result) : formatFailureBlock(result);
    const candidate = joinSections([...sections, nextSection]);

    if (byteLength(candidate) <= MAX_PR_COMMENT_BYTES) {
      sections.push(nextSection);
      continue;
    }

    const truncated = joinSections([
      ...sections,
      `- Additional eval detail omitted to stay under ${MAX_PR_COMMENT_BYTES} bytes.`,
    ]);
    return byteLength(truncated) <= MAX_PR_COMMENT_BYTES
      ? truncated
      : joinSections([
          '## Eval Summary',
          '',
          `- ${passedCount}/${ordered.length} passed`,
          `- ${failedCount} failed`,
          '- Additional eval detail omitted to stay under 4096 bytes.',
        ]);
  }

  return joinSections(sections);
}
