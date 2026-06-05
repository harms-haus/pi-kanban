/**
 * Integration Tests — Kanban Lifecycle
 *
 * End-to-end scenarios testing multiple tools working together
 * through realistic workflows.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetState, getBoard } from "../state";
import { writeKanbanTool } from "../tools/write-kanban";
import { createListKanbanTool } from "../tools/list-kanban";
import { createClaimTasksTool } from "../tools/claim-tasks";
import { createAdvanceTasksTool } from "../tools/advance-tasks";
import { createRejectTasksTool } from "../tools/reject-tasks";
import { createMockContext } from "./helpers/mock-api";
import { noop, mockSignal } from "./helpers/test-helpers";

const writeTool = writeKanbanTool();
const listTool = createListKanbanTool();
const claimTool = createClaimTasksTool();
const advanceTool = createAdvanceTasksTool();
const rejectTool = createRejectTasksTool();

const ctx = createMockContext();

describe("kanban lifecycle", () => {
  beforeEach(() => {
    resetState();
  });

  // ── Scenario 1: Happy path with dependencies ──

  it("happy path: create → claim → advance → done → unblock dependent → claim → advance → all done", async () => {
    // 1. Create board with 3 tasks: B depends on A, C depends on B
    await writeTool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [
          { title: "Setup", description: "Setup project" },
          { title: "Implement", description: "Write code", blockedBy: ["Setup"] },
          { title: "Review", description: "Code review", blockedBy: ["Implement"] },
        ],
      },
      mockSignal,
      noop,
      ctx,
    );

    let board = getBoard()!;
    expect(board.tasks).toHaveLength(3);
    // A is ready, B and C are blocked
    expect(board.tasks[0]!.status).toBe("ready");
    expect(board.tasks[1]!.status).toBe("blocked");
    expect(board.tasks[2]!.status).toBe("blocked");

    // 2. Claim 1 task (Setup)
    const claimResult = await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);
    expect((claimResult.content[0] as { type: string; text: string }).text).toContain("Claimed 1");

    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");

    // 3. Advance Setup through its single phase → done
    const advanceResult = await advanceTool.execute(
      "call-1",
      { ids: [board.tasks[0]!.id] },
      mockSignal,
      noop,
      ctx,
    );
    expect((advanceResult.content[0] as { type: string; text: string }).text).toContain(
      "Completed",
    );

    // 4. Implement should now be unblocked (ready)
    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("done");
    expect(board.tasks[1]!.status).toBe("ready");
    expect(board.tasks[2]!.status).toBe("blocked");

    // 5. Claim Implement
    await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks[1]!.status).toBe("claimed");

    // 6. Advance Implement → done
    await advanceTool.execute("call-1", { ids: [board.tasks[1]!.id] }, mockSignal, noop, ctx);

    // 7. Review should now be unblocked
    board = getBoard()!;
    expect(board.tasks[1]!.status).toBe("done");
    expect(board.tasks[2]!.status).toBe("ready");

    // 8. Claim and advance Review
    await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);
    board = getBoard()!;
    expect(board.tasks[2]!.status).toBe("claimed");

    await advanceTool.execute("call-1", { ids: [board.tasks[2]!.id] }, mockSignal, noop, ctx);

    // 9. All done
    board = getBoard()!;
    expect(board.tasks.every((t) => t.status === "done")).toBe(true);

    // 10. List should still work
    const listResult = await listTool.execute("call-1", {}, mockSignal, noop, ctx);
    expect((listResult.content[0] as { type: string; text: string }).text).toContain(
      "Kanban Board",
    );
    expect(listResult.details.board!.tasks).toHaveLength(3);
  });

  // ── Scenario 2: Edit mid-lifecycle ──

  it("edit mid-lifecycle: create → claim → edit title → verify → advance → done", async () => {
    // 1. Create board
    await writeTool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [{ title: "Original Title", description: "Original description" }],
      },
      mockSignal,
      noop,
      ctx,
    );

    let board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Original Title");

    // 2. Claim the task
    await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");

    // 3. Edit title while claimed
    await writeTool.execute(
      "call-1",
      {
        mode: "edit",
        edits: [{ id: board.tasks[0]!.id, set: { title: "Updated Title" } }],
      },
      mockSignal,
      noop,
      ctx,
    );

    // 4. Verify edit took effect
    board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Updated Title");
    expect(board.tasks[0]!.status).toBe("claimed"); // still claimed

    // 5. Advance through phases to done (single phase: implement)
    await advanceTool.execute("call-1", { ids: [board.tasks[0]!.id] }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("done");
    expect(board.tasks[0]!.currentPhaseIndex).toBe(-1);
  });

  // ── Scenario 3: Append and continue ──

  it("append and continue: create → append → verify IDs → claim → advance", async () => {
    // 1. Create board with 2 tasks
    await writeTool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [
          { title: "Task A", description: "First task" },
          { title: "Task B", description: "Second task" },
        ],
      },
      mockSignal,
      noop,
      ctx,
    );

    let board = getBoard()!;
    expect(board.tasks.map((t) => t.id)).toEqual(["kb-1", "kb-2"]);
    expect(board.nextId).toBe(3);

    // 2. Append 2 new tasks
    await writeTool.execute(
      "call-1",
      {
        mode: "append",
        tasks: [
          { title: "Task C", description: "Third task" },
          { title: "Task D", description: "Fourth task" },
        ],
      },
      mockSignal,
      noop,
      ctx,
    );

    board = getBoard()!;
    expect(board.tasks).toHaveLength(4);
    expect(board.tasks.map((t) => t.id)).toEqual(["kb-1", "kb-2", "kb-3", "kb-4"]);
    expect(board.nextId).toBe(5);

    // 3. All 4 tasks should be ready (no dependencies)
    expect(board.tasks.every((t) => t.status === "ready")).toBe(true);

    // 4. Claim all 4
    const claimResult = await claimTool.execute("call-1", { count: 4 }, mockSignal, noop, ctx);
    expect((claimResult.content[0] as { type: string; text: string }).text).toContain("Claimed 4");

    board = getBoard()!;
    expect(board.tasks.every((t) => t.status === "claimed")).toBe(true);

    // 5. Advance all to done
    const allIds = board.tasks.map((t) => t.id);
    await advanceTool.execute("call-1", { ids: allIds }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks.every((t) => t.status === "done")).toBe(true);
  });

  // ── Scenario 4: Reject and re-execute ──

  it("reject and re-execute: create → claim → reject → re-claim → advance → done", async () => {
    // 1. Create board with a multi-phase task
    await writeTool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [
          {
            title: "Complex Task",
            description: "Needs multiple attempts",
            phases: ["implement", "review"],
          },
        ],
      },
      mockSignal,
      noop,
      ctx,
    );

    let board = getBoard()!;
    const taskId = board.tasks[0]!.id;

    // 2. Claim the task
    await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0); // at implement phase

    // 3. Advance to review phase
    await advanceTool.execute("call-1", { ids: [taskId] }, mockSignal, noop, ctx);

    board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(1); // at review phase

    // 4. Reject with reason (goes back to phase 0)
    await rejectTool.execute(
      "call-1",
      { ids: [taskId], reason: "Needs refactoring" },
      mockSignal,
      noop,
      ctx,
    );

    board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0); // back to phase 0
    expect(board.tasks[0]!.status).toBe("claimed"); // still claimed
    expect(board.tasks[0]!.reason).toBe("Needs refactoring");

    // 5. Advance through both phases to done
    await advanceTool.execute("call-1", { ids: [taskId] }, mockSignal, noop, ctx);
    board = getBoard()!;
    expect(board.tasks[0]!.currentPhaseIndex).toBe(1); // back to review

    await advanceTool.execute("call-1", { ids: [taskId] }, mockSignal, noop, ctx);
    board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("done");
    expect(board.tasks[0]!.currentPhaseIndex).toBe(-1);
  });

  // ── Scenario 5: Multi-phase tasks with maxClaims ──

  it("respects maxClaims across phases", async () => {
    // 1. Create board with maxClaims=2 and 3 ready tasks
    await writeTool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [
          { title: "Task A", description: "First" },
          { title: "Task B", description: "Second" },
          { title: "Task C", description: "Third" },
        ],
      },
      mockSignal,
      noop,
      ctx,
    );

    // Override maxClaims to 2
    const board = getBoard()!;
    board.maxClaims = 2;

    // 2. Claim 2 (at maxClaims)
    await claimTool.execute("call-1", { count: 3 }, mockSignal, noop, ctx);

    const claimedCount = getBoard()!.tasks.filter((t) => t.status === "claimed").length;
    expect(claimedCount).toBe(2); // limited to maxClaims

    // 3. Try to claim more — should not exceed maxClaims
    const claimResult = await claimTool.execute("call-1", { count: 1 }, mockSignal, noop, ctx);
    expect((claimResult.content[0] as { type: string; text: string }).text).toContain(
      "outstanding",
    );

    const finalClaimedCount = getBoard()!.tasks.filter((t) => t.status === "claimed").length;
    expect(finalClaimedCount).toBe(2); // still at maxClaims
  });
});
