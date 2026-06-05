import { describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { createRejectTasksTool } from "../../tools/reject-tasks";
import { resetState, getBoard } from "../../state";
import { createMockContext, createMockTheme } from "../helpers/mock-api";
import { makeTask, setupBoard, noop, mockSignal } from "../helpers/test-helpers";

const tool = createRejectTasksTool();
const mockCtx = createMockContext();

describe("reject_tasks tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("rejects claimed tasks back one phase", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
      profile: "task-reviewer",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Rejected"),
    });

    const board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0);
  });

  it("updates profile and keeps status as claimed", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
      profile: "task-reviewer",
    });
    setupBoard([t1]);

    await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");
    expect(board.tasks[0]!.profile).toBe("task-worker");
  });

  it("stores rejection reason", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
    });
    setupBoard([t1]);

    await tool.execute(
      "call-1",
      { ids: [t1.id], reason: "Needs more tests" },
      mockSignal,
      noop,
      mockCtx,
    );

    const board = getBoard()!;
    expect(board.tasks[0]!.reason).toBe("Needs more tests");
  });

  it("allows rejection at first phase (records reason without changing phase)", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "claimed",
    });
    setupBoard([t1]);

    const result = await tool.execute(
      "call-1",
      { ids: [t1.id], reason: "Needs rework" },
      mockSignal,
      noop,
      mockCtx,
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Rejected"),
    });

    // State: phase stays 0, status stays claimed, reason recorded
    const board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0);
    expect(board.tasks[0]!.status).toBe("claimed");
    expect(board.tasks[0]!.reason).toBe("Needs rework");
  });

  it("throws for non-claimed tasks", async () => {
    const t1 = makeTask({ title: "Task A", status: "ready" });
    setupBoard([t1]);

    await expect(
      tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow("not claimed");
  });

  it("atomic: no partial changes on error", async () => {
    const t1 = makeTask({
      title: "Valid",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
    });
    const t2 = makeTask({
      title: "Not Claimed",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "ready",
    });
    setupBoard([t1, t2]);

    await expect(
      tool.execute("call-1", { ids: [t1.id, t2.id] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow();

    // t1 should be unchanged
    const board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(1);
    expect(board.tasks[0]!.status).toBe("claimed");
  });

  it("throws for non-existent IDs", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
    });
    setupBoard([t1]);

    await expect(
      tool.execute("call-1", { ids: ["nonexistent-id"] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow("not found");
  });

  it("throws when no board exists", async () => {
    await expect(
      tool.execute("call-1", { ids: ["any-id"] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow("No board exists");
  });

  it("publishes kanban status to UI on success", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
      profile: "task-reviewer",
    });
    setupBoard([t1]);

    await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, ctxWithUI);

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(1);
    expect(payload.claimed).toBe(1);
    expect(payload.claimedTasks[0]!.phase).toBe("implement");
  });

  // ── renderCall ──

  it("renderCall returns themed text with tool name and count", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ ids: ["kb-1", "kb-2"] }, theme, {} as any);
    expect(result).toBeDefined();
    const lines = result.render(80);
    expect(lines.join("\n")).toContain("reject_tasks");
    expect(lines.join("\n")).toContain("2");
  });

  it("renderCall includes reason when provided", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ ids: ["kb-1"], reason: "Needs rework" }, theme, {} as any);
    expect(result).toBeDefined();
    const lines = result.render(80);
    expect(lines.join("\n")).toContain("Needs rework");
  });

  it("renderCall omits reason when not provided", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ ids: ["kb-1"] }, theme, {} as any);
    expect(result).toBeDefined();
    const lines = result.render(80);
    expect(lines.join("\n")).toContain("reject_tasks");
    // No reason text should be appended
    expect(lines.join("\n")).not.toContain("Needs rework");
  });

  it("details contain board snapshot on success", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 1,
      status: "claimed",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    expect(result.details.action).toBe("reject");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks[0]!.currentPhaseIndex).toBe(0);
    expect(result.details.board!.tasks[0]!.status).toBe("claimed");
  });
});
