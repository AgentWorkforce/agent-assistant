import { describe, expect, it } from 'vitest';
import { parseHumanEvalCasesMarkdown } from '../src/evals/human-markdown.js';

describe('parseHumanEvalCasesMarkdown', () => {
  it('parses human-authored case markdown into JSONL-shaped cases', () => {
    const cases = parseHumanEvalCasesMarkdown(`
# Planning Cases

\`\`\`text
## ignored.example
### Message
This fenced example should not become a case.
\`\`\`

## planning.one-question
Executor: sage
Kind: regression
Tags: planning, slack
Human Review: true
Trials: 2

### Message
Help me plan a feature.

### Thread History
- user: previous request
- assistant: previous reply

### Deterministic Checks
contentMatches:
- \\?
maxQuestionMarks: 1
forbidPhrases:
- all done

### Must
- Ask one clarifying question.

### Must Not
- Ask a question list.
`, { suite: 'planning', sourcePath: 'evals/suites/planning/cases.md' });

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: 'planning.one-question',
      suite: 'planning',
      executor: 'sage',
      kind: 'regression',
      tags: ['planning', 'slack'],
      trials: 2,
      input: {
        message: 'Help me plan a feature.',
        threadHistory: [
          { role: 'user', content: 'previous request' },
          { role: 'assistant', content: 'previous reply' },
        ],
      },
      expected: {
        contentMatches: ['\\?'],
        maxQuestionMarks: 1,
        forbidPhrases: ['all done'],
        humanReviewRequired: true,
        must: ['Ask one clarifying question.'],
        mustNot: ['Ask a question list.'],
      },
    });
  });
});
