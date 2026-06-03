import { describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { publishKanbanStatus, type KanbanStatusPayload } from "../status";
import { resetState } from "../state";
import { createMockContext } from "./helpers/mock-api";
import { makeTask, setupBoard } from "./helpers/test-board";

describe("publishKanbanStatus", () => {
  beforeEach(() => {
    resetState();
  });

  it("publishes correct counts and claimedTasks for mixed board", () => {
    const ctx = createMockContext({ hasUI: true });
    const t1 = makeTask({
      title: "Claimed A",
      status: "claimed",
      phases: ["implement"],
      currentPhaseIndex: 0,
    });
    const t2 = makeTask({
      title: "Claimed B",
      status: "claimed",
      phases: ["test", "implement"],
      currentPhaseIndex: 1,
    });
    const t3 = makeTask({ title: "Ready A", status: "ready" });
    const t4 = makeTask({ title: "Blocked A", status: "blocked" });
    const t5 = makeTask({ title: "Done A", status: "done", currentPhaseIndex: -1 });
    const board = setupBoard([t1, t2, t3, t4, t5]);

    publishKanbanStatus(board, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload: KanbanStatusPayload = JSON.parse(
      (ctx.ui.setStatus as Mock).mock.calls[0]![1] as string,
    );
    expect(payload.total).toBe(5);
    expect(payload.claimed).toBe(2);
    expect(payload.ready).toBe(1);
    expect(payload.blocked).toBe(1);
    expect(payload.done).toBe(1);
    expect(payload.claimedTasks).toHaveLength(2);
    expect(payload.claimedTasks[0]!.id).toBe(t1.id);
    expect(payload.claimedTasks[0]!.title).toBe("Claimed A");
    expect(payload.claimedTasks[0]!.phase).toBe("implement");
    expect(payload.claimedTasks[1]!.id).toBe(t2.id);
    expect(payload.claimedTasks[1]!.title).toBe("Claimed B");
    expect(payload.claimedTasks[1]!.phase).toBe("implement");
  });

  it("does not call setStatus when hasUI is false", () => {
    const ctx = createMockContext({ hasUI: false });
    const t1 = makeTask({ title: "Task A", status: "ready" });
    const board = setupBoard([t1]);

    publishKanbanStatus(board, ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("publishes zero counts for empty board", () => {
    const ctx = createMockContext({ hasUI: true });
    const board = setupBoard([]);

    publishKanbanStatus(board, ctx);

    const payload: KanbanStatusPayload = JSON.parse(
      (ctx.ui.setStatus as Mock).mock.calls[0]![1] as string,
    );
    expect(payload.total).toBe(0);
    expect(payload.claimed).toBe(0);
    expect(payload.ready).toBe(0);
    expect(payload.blocked).toBe(0);
    expect(payload.done).toBe(0);
    expect(payload.claimedTasks).toEqual([]);
  });

  it("includes correct phase for claimed tasks", () => {
    const ctx = createMockContext({ hasUI: true });
    const t1 = makeTask({
      title: "Multi-phase",
      status: "claimed",
      phases: ["test", "implement", "review"],
      currentPhaseIndex: 2,
    });
    const board = setupBoard([t1]);

    publishKanbanStatus(board, ctx);

    const payload: KanbanStatusPayload = JSON.parse(
      (ctx.ui.setStatus as Mock).mock.calls[0]![1] as string,
    );
    expect(payload.claimedTasks).toHaveLength(1);
    expect(payload.claimedTasks[0]!.phase).toBe("review");
  });

  it("counts each status independently", () => {
    const ctx = createMockContext({ hasUI: true });
    const t1 = makeTask({ status: "ready" });
    const t2 = makeTask({ status: "ready" });
    const t3 = makeTask({ status: "ready" });
    const t4 = makeTask({ status: "blocked" });
    const t5 = makeTask({ status: "blocked" });
    const t6 = makeTask({ status: "done", currentPhaseIndex: -1 });
    const board = setupBoard([t1, t2, t3, t4, t5, t6]);

    publishKanbanStatus(board, ctx);

    const payload: KanbanStatusPayload = JSON.parse(
      (ctx.ui.setStatus as Mock).mock.calls[0]![1] as string,
    );
    expect(payload.total).toBe(6);
    expect(payload.claimed).toBe(0);
    expect(payload.ready).toBe(3);
    expect(payload.blocked).toBe(2);
    expect(payload.done).toBe(1);
    expect(payload.claimedTasks).toEqual([]);
  });
});
