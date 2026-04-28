import { describe, expect, it } from 'vitest';
import {
  CITE_SOURCE_PATHS_CLAUSE,
  DRILL_IN_DISCIPLINE_CLAUSE,
  EMPTY_RESULT_HONESTY_CLAUSE,
  EXTERNAL_REPO_STEER_CLAUSE,
  HALLUCINATION_PREVENTION_CLAUSES,
  SURFACE_TOOL_ERRORS_CLAUSE,
  TOOL_DISCIPLINE_CLAUSES,
  TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
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

describe('tool-discipline prompt fragments', () => {
  it('exports the new clauses as non-empty strings with the expected key terms', () => {
    expect(DRILL_IN_DISCIPLINE_CLAUSE.length).toBeGreaterThanOrEqual(80);
    expect(DRILL_IN_DISCIPLINE_CLAUSE.toLowerCase()).toContain('drill');
    expect(
      DRILL_IN_DISCIPLINE_CLAUSE.toLowerCase().includes('enumeration') ||
        DRILL_IN_DISCIPLINE_CLAUSE.toLowerCase().includes('re-issue'),
    ).toBe(true);

    expect(TOOL_INPUT_SHAPE_REMINDER_CLAUSE.length).toBeGreaterThanOrEqual(80);
    expect(TOOL_INPUT_SHAPE_REMINDER_CLAUSE.toLowerCase()).toContain('schema');
    expect(TOOL_INPUT_SHAPE_REMINDER_CLAUSE.toLowerCase()).toContain('description');

    expect(EXTERNAL_REPO_STEER_CLAUSE.length).toBeGreaterThanOrEqual(80);
    expect(EXTERNAL_REPO_STEER_CLAUSE).toContain('github_public_review');
    expect(EXTERNAL_REPO_STEER_CLAUSE.match(/github_public_review/g)).toHaveLength(1);
    expect(EXTERNAL_REPO_STEER_CLAUSE.toLowerCase()).toContain('owner');
    expect(EXTERNAL_REPO_STEER_CLAUSE.toLowerCase()).toContain('repo');
  });

  it('exports the tool-discipline clauses in append-ready order', () => {
    expect(TOOL_DISCIPLINE_CLAUSES).toEqual([
      DRILL_IN_DISCIPLINE_CLAUSE,
      TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
      EXTERNAL_REPO_STEER_CLAUSE,
    ]);
    expect(TOOL_DISCIPLINE_CLAUSES).toHaveLength(3);
  });

  it('keeps tool-discipline clauses separate from hallucination-prevention clauses', () => {
    expect(HALLUCINATION_PREVENTION_CLAUSES).not.toContain(DRILL_IN_DISCIPLINE_CLAUSE);
    expect(HALLUCINATION_PREVENTION_CLAUSES).not.toContain(
      TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
    );
    expect(HALLUCINATION_PREVENTION_CLAUSES).not.toContain(EXTERNAL_REPO_STEER_CLAUSE);
  });
});
