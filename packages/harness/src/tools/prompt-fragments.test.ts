import { describe, expect, it } from 'vitest';
import {
  CITE_SOURCE_PATHS_CLAUSE,
  EMPTY_RESULT_HONESTY_CLAUSE,
  HALLUCINATION_PREVENTION_CLAUSES,
  SURFACE_TOOL_ERRORS_CLAUSE,
} from './prompt-fragments.js';

describe('hallucination-prevention prompt fragments', () => {
  it('exports non-empty clauses in append-ready order', () => {
    expect(HALLUCINATION_PREVENTION_CLAUSES).toEqual([
      CITE_SOURCE_PATHS_CLAUSE,
      EMPTY_RESULT_HONESTY_CLAUSE,
      SURFACE_TOOL_ERRORS_CLAUSE,
    ]);
    expect(HALLUCINATION_PREVENTION_CLAUSES.every((clause) => clause.length > 0)).toBe(
      true,
    );
  });

  it('keeps the load-bearing source citation phrase', () => {
    expect(CITE_SOURCE_PATHS_CLAUSE.toLowerCase()).toContain('cite');
    expect(CITE_SOURCE_PATHS_CLAUSE).toContain('path');
  });

  it('keeps the load-bearing empty result phrase', () => {
    expect(EMPTY_RESULT_HONESTY_CLAUSE.toLowerCase()).toContain('empty');
    expect(EMPTY_RESULT_HONESTY_CLAUSE.toLowerCase()).toContain('not found');
  });

  it('keeps the load-bearing tool error phrase', () => {
    expect(SURFACE_TOOL_ERRORS_CLAUSE.toLowerCase()).toContain('error');
    expect(SURFACE_TOOL_ERRORS_CLAUSE.toLowerCase()).toContain('tool');
  });
});
