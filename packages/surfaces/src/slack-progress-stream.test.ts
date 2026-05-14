import { describe, expect, it, vi } from "vitest";

import {
  appendSlackProgressStream,
  createSlackTaskUpdate,
  finishSlackProgressStream,
  startSlackProgressStream,
  type SlackProgressStreamEgress,
} from "./slack-progress-stream.js";

describe("createSlackTaskUpdate", () => {
  it("builds compact Slack task update chunks", () => {
    expect(
      createSlackTaskUpdate({
        id: "sync",
        title: "Sync",
        status: "complete",
        details: "2 skills",
      }),
    ).toEqual({
      type: "task_update",
      id: "sync",
      title: "Sync",
      status: "complete",
      details: "2 skills",
    });
  });

  it("omits empty optional fields", () => {
    expect(createSlackTaskUpdate({ id: "prepare", title: "", details: "" })).toEqual({
      type: "task_update",
      id: "prepare",
    });
  });
});

describe("startSlackProgressStream", () => {
  it("starts a Slack stream with recipients, display mode, and chunks", async () => {
    const startStream = vi.fn<SlackProgressStreamEgress["startStream"]>().mockResolvedValue({
      ok: true,
      ts: "1710000000.000100",
    });

    const result = await startSlackProgressStream({
      egress: { startStream },
      workspaceId: "workspace-1",
      channel: "C123",
      threadTs: "1700000000.000100",
      markdownText: "Working...",
      recipientUserId: "U123",
      recipientTeamId: "T123",
      taskDisplayMode: "timeline",
      chunks: [createSlackTaskUpdate({ id: "prepare", title: "Prepare", status: "in_progress" })],
    });

    expect(result).toEqual({ ok: true, ts: "1710000000.000100" });
    expect(startStream).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      channel: "C123",
      threadTs: "1700000000.000100",
      markdownText: "Working...",
      recipientUserId: "U123",
      recipientTeamId: "T123",
      taskDisplayMode: "timeline",
      chunks: [
        {
          type: "task_update",
          id: "prepare",
          title: "Prepare",
          status: "in_progress",
        },
      ],
    });
  });

  it("converts thrown start errors into failed results", async () => {
    const startStream = vi
      .fn<SlackProgressStreamEgress["startStream"]>()
      .mockRejectedValue(new Error("Slack unavailable"));

    await expect(
      startSlackProgressStream({
        egress: { startStream },
        channel: "C123",
        threadTs: "1700000000.000100",
      }),
    ).resolves.toEqual({ ok: false, error: "Slack unavailable" });
  });
});

describe("appendSlackProgressStream", () => {
  it("appends markdown and chunks when appendStream is supported", async () => {
    const appendStream = vi
      .fn<NonNullable<SlackProgressStreamEgress["appendStream"]>>()
      .mockResolvedValue({
        ok: true,
        ts: "1710000000.000100",
      });

    const result = await appendSlackProgressStream({
      egress: { appendStream },
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Still working...",
      chunks: [createSlackTaskUpdate({ id: "load", status: "in_progress" })],
    });

    expect(result).toEqual({ ok: true, ts: "1710000000.000100" });
    expect(appendStream).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Still working...",
      chunks: [{ type: "task_update", id: "load", status: "in_progress" }],
    });
  });

  it("reports unsupported appendStream without throwing", async () => {
    await expect(
      appendSlackProgressStream({
        egress: {},
        channel: "C123",
        ts: "1710000000.000100",
        markdownText: "Still working...",
      }),
    ).resolves.toEqual({ ok: false, error: "Slack appendStream is not available" });
  });
});

describe("finishSlackProgressStream", () => {
  it("stops a stream with rich final content", async () => {
    const stopStream = vi.fn<SlackProgressStreamEgress["stopStream"]>().mockResolvedValue({
      ok: true,
      ts: "1710000000.000100",
    });

    const result = await finishSlackProgressStream({
      egress: { stopStream },
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Done",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Done" } }],
      chunks: [createSlackTaskUpdate({ id: "done", status: "complete" })],
    });

    expect(result).toEqual({ ok: true, ts: "1710000000.000100", fallback: "none" });
    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(stopStream).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Done",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Done" } }],
      chunks: [{ type: "task_update", id: "done", status: "complete" }],
    });
  });

  it("retries with a minimal stop when rich final content fails", async () => {
    const stopStream = vi
      .fn<SlackProgressStreamEgress["stopStream"]>()
      .mockResolvedValueOnce({ ok: false, error: "invalid_blocks" })
      .mockResolvedValueOnce({ ok: true, ts: "1710000000.000100" });

    const result = await finishSlackProgressStream({
      egress: { stopStream },
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Done",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Done" } }],
      chunks: [createSlackTaskUpdate({ id: "done", status: "complete" })],
    });

    expect(result).toEqual({
      ok: true,
      ts: "1710000000.000100",
      fallback: "minimal_stop",
    });
    expect(stopStream).toHaveBeenNthCalledWith(2, {
      workspaceId: "workspace-1",
      channel: "C123",
      ts: "1710000000.000100",
      markdownText: "Done",
    });
  });

  it("keeps the original rich failure when the minimal fallback also fails", async () => {
    const stopStream = vi
      .fn<SlackProgressStreamEgress["stopStream"]>()
      .mockResolvedValueOnce({ ok: false, error: "invalid_blocks" })
      .mockResolvedValueOnce({ ok: false });

    await expect(
      finishSlackProgressStream({
        egress: { stopStream },
        channel: "C123",
        ts: "1710000000.000100",
        markdownText: "Done",
        chunks: [createSlackTaskUpdate({ id: "done", status: "complete" })],
      }),
    ).resolves.toEqual({
      ok: false,
      error: "invalid_blocks",
      fallback: "minimal_stop",
    });
  });

  it("does not retry plain stop failures", async () => {
    const stopStream = vi.fn<SlackProgressStreamEgress["stopStream"]>().mockResolvedValue({
      ok: false,
      error: "not_in_progress",
    });

    await expect(
      finishSlackProgressStream({
        egress: { stopStream },
        channel: "C123",
        ts: "1710000000.000100",
        markdownText: "Done",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "not_in_progress",
      fallback: "none",
    });
    expect(stopStream).toHaveBeenCalledTimes(1);
  });
});
