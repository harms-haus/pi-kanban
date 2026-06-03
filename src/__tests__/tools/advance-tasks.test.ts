import { describe, it, expect, beforeEach } from "vitest";
import { createAdvanceTasksTool } from "../../tools/advance-tasks";
import { resetState, getBoard } from "../../state";
import { createMockContext } from "../helpers/mock-api";
import { makeTask, setupBoard, noop, mockSignal } from "../helpers/test-board";

const tool = createAdvanceTasksTool();
const mockCtx = createMockContext();

describe("advance_tasks tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("advances claimed tasks to next phase", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 0,
      status: "claimed",
      profile: "task-worker",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Advanced"),
    });

    const board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(1);
    expect(board.tasks[0]!.status).toBe("claimed");
  });

  it("task reaching final phase → done", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "claimed",
      profile: "task-worker",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Completed"),
    });

    const board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(-1);
    expect(board.tasks[0]!.status).toBe("done");
  });

  it("done tasks unblock dependents", async () => {
    const t1 = makeTask({
      title: "Setup",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "claimed",
      profile: "task-worker",
    });
    const t2 = makeTask({
      title: "Implement",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "blocked",
      blockedBy: [t1.id],
    });
    setupBoard([t1, t2]);

    await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("done");
    expect(board.tasks[1]!.status).toBe("ready");
  });

  it("throws for non-existent IDs", async () => {
    const t1 = makeTask({ title: "Task A", status: "claimed" });
    setupBoard([t1]);

    await expect(
      tool.execute("call-1", { ids: ["nonexistent-id"] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/not found/);
  });

  it("throws for non-claimed tasks", async () => {
    const t1 = makeTask({ title: "Task A", status: "ready" });
    setupBoard([t1]);

    await expect(
      tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/not claimed/);
  });

  it("atomic: no partial changes on error", async () => {
    const t1 = makeTask({
      title: "Valid",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "claimed",
    });
    const t2 = makeTask({ title: "Not Claimed", status: "ready" });
    setupBoard([t1, t2]);

    // t1 is valid but t2 is not claimed → should throw, t1 unchanged
    await expect(
      tool.execute("call-1", { ids: [t1.id, t2.id] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow();

    const board = getBoard()!;
    // t1 should still be at index 0 and claimed (unchanged)
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0);
    expect(board.tasks[0]!.status).toBe("claimed");
  });

  it("updates profile for new phase", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 0,
      status: "claimed",
      profile: "task-worker",
    });
    setupBoard([t1]);

    await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    expect(board.tasks[0]!.profile).toBe("task-reviewer");
  });

  it("throws when no board exists", async () => {
    await expect(
      tool.execute("call-1", { ids: ["any-id"] }, mockSignal, noop, mockCtx),
    ).rejects.toThrow("No board exists");
  });

  it("deduplicates IDs in a single call", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement", "review"],
      currentPhaseIndex: 0,
      status: "claimed",
    });
    setupBoard([t1]);

    await tool.execute("call-1", { ids: [t1.id, t1.id] }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    // Should only advance once (deduplicated)
    expect(board.tasks[0]!.currentPhaseIndex).toBe(1);
  });

  it("details contain board snapshot", async () => {
    const t1 = makeTask({
      title: "Task A",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "claimed",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { ids: [t1.id] }, mockSignal, noop, mockCtx);

    expect(result.details.action).toBe("advance");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks[0]!.status).toBe("done");
  });
});
