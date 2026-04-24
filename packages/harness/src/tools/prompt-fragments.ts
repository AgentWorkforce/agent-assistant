export const CITE_SOURCE_PATHS_CLAUSE =
  'For every factual claim about workspace data, cite the tool-returned VFS path or sourcePath that supports it. If a tool result has no path/sourcePath, say what tool result you used.';

export const EMPTY_RESULT_HONESTY_CLAUSE =
  'If a tool returns an empty array, null, or a "not found" message, do not substitute prior knowledge. Say exactly what could not be verified and name the path/query that returned no data.';

export const SURFACE_TOOL_ERRORS_CLAUSE =
  'If a tool returns an error, include the redacted tool name and error message in the answer instead of inventing a plausible result.';

export const HALLUCINATION_PREVENTION_CLAUSES = [
  CITE_SOURCE_PATHS_CLAUSE,
  EMPTY_RESULT_HONESTY_CLAUSE,
  SURFACE_TOOL_ERRORS_CLAUSE,
] as const;
