export type SlackProgressTaskStatus = "pending" | "in_progress" | "complete" | "error";

export type SlackProgressTaskUpdate = {
  type: "task_update";
  id: string;
  title?: string;
  status?: SlackProgressTaskStatus;
  details?: string;
  output?: string;
};

export type SlackProgressChunk =
  | { type: "markdown_text"; markdown_text: string }
  | SlackProgressTaskUpdate
  | { type: "plan_update"; [key: string]: unknown }
  | { type: "blocks"; blocks: unknown[] };

export type SlackProgressTaskDisplayMode = "timeline" | "plan" | "dense";

export interface SlackProgressResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

export interface SlackProgressStreamEgress {
  startStream(input: {
    workspaceId?: string;
    channel: string;
    threadTs: string;
    markdownText?: string;
    recipientUserId?: string;
    recipientTeamId?: string;
    taskDisplayMode?: SlackProgressTaskDisplayMode;
    chunks?: SlackProgressChunk[];
  }): Promise<SlackProgressResult>;

  appendStream?(input: {
    workspaceId?: string;
    channel: string;
    ts: string;
    markdownText: string;
    chunks?: SlackProgressChunk[];
  }): Promise<SlackProgressResult>;

  stopStream(input: {
    workspaceId?: string;
    channel: string;
    ts: string;
    markdownText?: string;
    blocks?: unknown[];
    chunks?: SlackProgressChunk[];
  }): Promise<SlackProgressResult>;
}

export interface SlackProgressStartInput {
  egress: Pick<SlackProgressStreamEgress, "startStream">;
  workspaceId?: string;
  channel: string;
  threadTs: string;
  markdownText?: string;
  recipientUserId?: string;
  recipientTeamId?: string;
  taskDisplayMode?: SlackProgressTaskDisplayMode;
  chunks?: SlackProgressChunk[];
}

export interface SlackProgressAppendInput {
  egress: Pick<SlackProgressStreamEgress, "appendStream">;
  workspaceId?: string;
  channel: string;
  ts: string;
  markdownText: string;
  chunks?: SlackProgressChunk[];
}

export type SlackProgressFinishFallback = "none" | "minimal_stop";

export interface SlackProgressFinishResult extends SlackProgressResult {
  fallback: SlackProgressFinishFallback;
}

export interface SlackProgressFinishInput {
  egress: Pick<SlackProgressStreamEgress, "stopStream">;
  workspaceId?: string;
  channel: string;
  ts: string;
  markdownText?: string;
  blocks?: unknown[];
  chunks?: SlackProgressChunk[];
}

export function createSlackTaskUpdate(input: {
  id: string;
  title?: string;
  status?: SlackProgressTaskStatus;
  details?: string;
  output?: string;
}): SlackProgressTaskUpdate {
  return {
    type: "task_update",
    id: input.id,
    ...(input.title ? { title: input.title } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.details ? { details: input.details } : {}),
    ...(input.output ? { output: input.output } : {}),
  };
}

export async function startSlackProgressStream(
  input: SlackProgressStartInput,
): Promise<SlackProgressResult> {
  try {
    return await input.egress.startStream({
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      channel: input.channel,
      threadTs: input.threadTs,
      ...(input.markdownText ? { markdownText: input.markdownText } : {}),
      ...(input.recipientUserId ? { recipientUserId: input.recipientUserId } : {}),
      ...(input.recipientTeamId ? { recipientTeamId: input.recipientTeamId } : {}),
      ...(input.taskDisplayMode ? { taskDisplayMode: input.taskDisplayMode } : {}),
      ...(input.chunks ? { chunks: input.chunks } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    };
  }
}

export async function appendSlackProgressStream(
  input: SlackProgressAppendInput,
): Promise<SlackProgressResult> {
  if (!input.egress.appendStream) {
    return { ok: false, error: "Slack appendStream is not available" };
  }

  try {
    return await input.egress.appendStream({
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      channel: input.channel,
      ts: input.ts,
      markdownText: input.markdownText,
      ...(input.chunks ? { chunks: input.chunks } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    };
  }
}

export async function finishSlackProgressStream(
  input: SlackProgressFinishInput,
): Promise<SlackProgressFinishResult> {
  const rich = await stopSlackProgressStream(input);
  if (rich.ok) {
    return { ...rich, fallback: "none" };
  }

  if (!input.blocks && !input.chunks) {
    return { ...rich, fallback: "none" };
  }

  const minimal = await stopSlackProgressStream({
    egress: input.egress,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    channel: input.channel,
    ts: input.ts,
    ...(input.markdownText ? { markdownText: input.markdownText } : {}),
  });
  if (minimal.ok) {
    return { ...minimal, fallback: "minimal_stop" };
  }

  return {
    ...minimal,
    error: minimal.error ?? rich.error,
    fallback: "minimal_stop",
  };
}

async function stopSlackProgressStream(
  input: SlackProgressFinishInput,
): Promise<SlackProgressResult> {
  try {
    return await input.egress.stopStream({
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      channel: input.channel,
      ts: input.ts,
      ...(input.markdownText ? { markdownText: input.markdownText } : {}),
      ...(input.blocks ? { blocks: input.blocks } : {}),
      ...(input.chunks ? { chunks: input.chunks } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Slack progress stream request failed";
}
