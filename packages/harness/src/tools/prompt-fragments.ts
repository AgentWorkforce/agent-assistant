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

export const DRILL_IN_DISCIPLINE_CLAUSE =
  "After a tool returns a useful hit (a path, an id, an entity), drill into THAT specific result on your next turn — read the file, fetch the entity, expand the id. Do NOT re-issue the same enumeration query hoping for different results. If the first result didn't answer the question, refine the query (different keywords, narrower scope, different tool); don't repeat it verbatim.";

export const TOOL_INPUT_SHAPE_REMINDER_CLAUSE =
  "Tool input schemas describe the SHAPE of the value you must provide; a description like 'A repository slug in owner/repo form' is not itself a valid value. Pass the actual value (e.g. 'AgentWorkforce/sage'), not the description text. If you don't have a real value, ask the user instead of submitting placeholder strings.";

export const EXTERNAL_REPO_STEER_CLAUSE =
  "When the user asks about a repository OUTSIDE their workspace (a public repo on GitHub, a competitor's project, an open-source library) use the github_public_review tool with { owner, repo } — it works against unauthenticated api.github.com and returns README + package.json + top-level layout + recent commits. Do NOT try github_specialist or workspace_search for external public repos; those only see the connected workspace.";

export const TOOL_DISCIPLINE_CLAUSES = [
  DRILL_IN_DISCIPLINE_CLAUSE,
  TOOL_INPUT_SHAPE_REMINDER_CLAUSE,
  EXTERNAL_REPO_STEER_CLAUSE,
] as const;
