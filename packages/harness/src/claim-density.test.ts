import { assert, describe, it } from 'vitest';

import { exceedsEvidenceBudget } from './claim-density.js';

const sparseWorkspaceListToolCalls = [
  { name: 'workspace_list', outputChars: 513 },
] as const;

const fiveRowMarkdownTable = [
  '| Commit | Repo | Note |',
  '| --- | --- | --- |',
  '| b5c1e2f | agent-assistant | Added harness retry telemetry |',
  '| a3d7890 | sage | Tightened worker bridge logging |',
  '| c4f8ab1 | burn | Updated local command adapter docs |',
  '| d91aa73 | ai-hist | Fixed trajectory export formatting |',
  '| ef02bc4 | relayfile | Reworked VFS hydration path |',
].join('\n');

describe('exceedsEvidenceBudget', () => {
  it('turn bepqzr — fabricated commits table from sparse evidence', () => {
    // Captured turn id: bepqzr
    const verdict = exceedsEvidenceBudget({
      toolCalls: sparseWorkspaceListToolCalls,
      assistantText: [
        'Here is the commit summary I found:',
        '',
        fiveRowMarkdownTable,
      ].join('\n'),
    });

    assert.equal(verdict.exceeds, true);
    assert.equal(verdict.reason, 'sparse_tool_evidence_with_structured_claims');
  });

  it('turn bepqzr variant — numbered list with SHA refs', () => {
    // Captured turn id: bepqzr
    const verdict = exceedsEvidenceBudget({
      toolCalls: sparseWorkspaceListToolCalls,
      assistantText: [
        '1. b5c1e2f - Added harness retry telemetry',
        '2. a3d7890 - Tightened worker bridge logging',
        '3. c4f8ab1 - Updated local command adapter docs',
      ].join('\n'),
    });

    assert.equal(verdict.exceeds, true);
    assert.equal(verdict.reason, 'sparse_tool_evidence_with_structured_claims');
  });

  it('legitimate 5-call investigation — table allowed', () => {
    // Captured turn id: legitimate-5-call-investigation
    const verdict = exceedsEvidenceBudget({
      toolCalls: [
        { name: 'workspace_list', outputChars: 1600 },
        { name: 'workspace_list', outputChars: 1600 },
        { name: 'workspace_list', outputChars: 1600 },
        { name: 'workspace_list', outputChars: 1600 },
        { name: 'workspace_list', outputChars: 1600 },
      ],
      assistantText: fiveRowMarkdownTable,
    });

    assert.equal(verdict.exceeds, false);
  });

  it('legitimate 1-call summary — no structured claims', () => {
    // Captured turn id: legitimate-1-call-summary
    const verdict = exceedsEvidenceBudget({
      toolCalls: [{ name: 'workspace_list', outputChars: 200 }],
      assistantText:
        "There are 22 repos including agent-assistant, ai-hist, burn — but I don't see relayfile.",
    });

    assert.equal(verdict.exceeds, false);
  });

  it('workspace_search single call with table', () => {
    // Captured turn id: workspace-search-single-call
    const verdict = exceedsEvidenceBudget({
      toolCalls: [{ name: 'workspace_search', outputChars: 900 }],
      assistantText: fiveRowMarkdownTable,
    });

    assert.equal(verdict.exceeds, true);
    assert.equal(verdict.reason, 'sparse_tool_evidence_with_structured_claims');
  });

  it('rich evidence boundary — outputChars=1024 exactly', () => {
    // Captured turn id: rich-evidence-boundary-1024
    const verdict = exceedsEvidenceBudget({
      toolCalls: [{ name: 'workspace_list', outputChars: 1024 }],
      assistantText: fiveRowMarkdownTable,
    });

    assert.equal(verdict.exceeds, false);
  });
});
