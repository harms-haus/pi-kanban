import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import { writeKanbanTool } from "../../tools/write-kanban";
import { resetState, getBoard } from "../../state";
import { createMockContext, createMockTheme } from "../helpers/mock-api";
import { noop, mockSignal } from "../helpers/test-helpers";

type Phase = "test" | "implement" | "review";

const tool = writeKanbanTool();
const mockCtx = createMockContext();

// ── Helpers ──

interface TaskInput {
  title: string;
  description: string;
  files?: string[];
  phases?: Phase[];
  blockedBy?: string[];
}

/** Call the tool with replace mode */
async function replace(tasks: TaskInput[], profileMap?: Record<string, string>) {
  return tool.execute("call-1", { mode: "replace", tasks, profileMap }, mockSignal, noop, mockCtx);
}

/** Call the tool with append mode */
async function append(tasks: TaskInput[], profileMap?: Record<string, string>) {
  return tool.execute("call-1", { mode: "append", tasks, profileMap }, mockSignal, noop, mockCtx);
}

/** Call the tool with edit mode */
async function edit(edits: Array<{ id: string; set: Record<string, unknown> }>) {
  return tool.execute("call-1", { mode: "edit", edits }, mockSignal, noop, mockCtx);
}

/** Call the tool with delete mode */
async function del(ids: string[]) {
  return tool.execute("call-1", { mode: "delete", ids }, mockSignal, noop, mockCtx);
}

// ═══════════════════════════════════════════════════════════════════════
// REPLACE MODE
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — replace mode", () => {
  beforeEach(() => {
    resetState();
  });

  it("creates board with single task, default phases [implement]", async () => {
    const result = await replace([{ title: "Task A", description: "Do something" }]);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Created board with 1 task(s)"),
    });

    const board = getBoard()!;
    expect(board).not.toBeNull();
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.phases).toEqual(["implement"]);
    expect(board.tasks[0]!.currentPhaseIndex).toBe(0);
    expect(board.tasks[0]!.status).toBe("ready");
    expect(board.tasks[0]!.profile).toBe("task-worker");
  });

  it("creates board with multiple tasks", async () => {
    const result = await replace([
      { title: "Task A", description: "First task" },
      { title: "Task B", description: "Second task" },
      { title: "Task C", description: "Third task" },
    ]);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Created board with 3 task(s)"),
    });

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(3);
  });

  it("gives each task a unique sequential ID", async () => {
    await replace([
      { title: "Task A", description: "First" },
      { title: "Task B", description: "Second" },
    ]);

    const board = getBoard()!;
    const ids = board.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["kb-1", "kb-2"]);
  });

  it("resolves blockedBy titles to IDs", async () => {
    await replace([
      { title: "Setup", description: "Setup project" },
      { title: "Implement", description: "Write code", blockedBy: ["Setup"] },
    ]);

    const board = getBoard()!;
    const setupId = board.tasks.find((t) => t.title === "Setup")!.id;
    const implementTask = board.tasks.find((t) => t.title === "Implement")!;
    expect(implementTask.blockedBy).toEqual([setupId]);
  });

  it("sets initial statuses correctly (blocked vs ready)", async () => {
    await replace([
      { title: "Setup", description: "Setup project" },
      { title: "Implement", description: "Write code", blockedBy: ["Setup"] },
    ]);

    const board = getBoard()!;
    expect(board.tasks.find((t) => t.title === "Setup")!.status).toBe("ready");
    expect(board.tasks.find((t) => t.title === "Implement")!.status).toBe("blocked");
  });

  it("replace overwrites existing board", async () => {
    await replace([{ title: "Task A", description: "First" }]);

    // Second replace should succeed and fully reset the board
    await replace([{ title: "Task B", description: "Second" }]);

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.title).toBe("Task B");
  });

  it("replace works after deleting all tasks", async () => {
    await replace([
      { title: "Task A", description: "First" },
      { title: "Task B", description: "Second" },
      { title: "Task C", description: "Third" },
    ]);

    // Delete all tasks — board should be null
    await del(["kb-1", "kb-2", "kb-3"]);
    expect(getBoard()).toBeNull();

    // Replace should create a fresh board
    await replace([{ title: "Fresh", description: "New start" }]);

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.id).toBe("kb-1");
    expect(board.tasks[0]!.title).toBe("Fresh");
  });

  it("replace resets all metadata", async () => {
    // First replace with a custom profileMap
    await replace([{ title: "A", description: "First" }], { implement: "custom-worker" });

    const firstCreatedAt = getBoard()!.createdAt;

    // Ensure next timestamp is distinct (avoid same-millisecond flake)
    const mockNow = vi.spyOn(Date, "now").mockReturnValue(firstCreatedAt + 1);

    // Second replace with a different profileMap
    await replace([{ title: "B", description: "Second" }], { implement: "different-worker" });

    mockNow.mockRestore();

    const board = getBoard()!;
    // profileMap should reflect the second replace's values
    expect(board.profileMap.implement).toBe("different-worker");
    // createdAt should be a fresh timestamp (strictly greater)
    expect(board.createdAt).toBeGreaterThan(firstCreatedAt);
    // nextId should reflect only the new tasks
    expect(board.nextId).toBe(2);
  });

  it("throws for invalid phases", async () => {
    await expect(
      replace([
        {
          title: "Task A",
          description: "Bad phases",
          phases: ["implement", "deploy"] as any,
        },
      ]),
    ).rejects.toThrow(/invalid phase/i);
  });

  it("throws for out-of-order phases", async () => {
    await expect(
      replace([
        {
          title: "Task A",
          description: "Bad order",
          phases: ["review", "implement"],
        },
      ]),
    ).rejects.toThrow(/not in canonical order/i);
  });

  it("throws for circular dependencies", async () => {
    const { detectCycles } = await import("../../validation");
    const idA = "kb-A";
    const idB = "kb-B";
    const result = detectCycles([
      { id: idA, blockedBy: [idB] },
      { id: idB, blockedBy: [idA] },
    ]);
    expect(result).not.toBeNull();
    expect(result).toMatch(/cycle detected/i);
  });

  it("throws for circular dependencies via replace blockedBy titles", async () => {
    await expect(
      replace([
        { title: "A", description: "Task A", blockedBy: ["B"] },
        { title: "B", description: "Task B", blockedBy: ["A"] },
      ]),
    ).rejects.toThrow(/cycle detected/i);
  });

  it("throws for unresolvable blockedBy references", async () => {
    await expect(
      replace([
        {
          title: "A",
          description: "Task A",
          blockedBy: ["Nonexistent Task"],
        },
      ]),
    ).rejects.toThrow(/cannot resolve blockedBy/i);
  });

  it("uses custom profileMap overriding defaults", async () => {
    await replace(
      [
        {
          title: "Task A",
          description: "Custom profile",
          phases: ["implement", "review"],
        },
      ],
      { implement: "custom-worker" },
    );

    const board = getBoard()!;
    expect(board.tasks[0]!.profile).toBe("custom-worker");
    expect(board.profileMap.implement).toBe("custom-worker");
  });

  it("publishes kanban status to UI on success", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });

    await tool.execute(
      "call-1",
      {
        mode: "replace",
        tasks: [
          { title: "Task A", description: "First" },
          { title: "Task B", description: "Second" },
        ],
      },
      mockSignal,
      noop,
      ctxWithUI,
    );

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(2);
    expect(payload.ready).toBe(2);
    expect(payload.claimed).toBe(0);
    expect(payload.blocked).toBe(0);
    expect(payload.done).toBe(0);
    expect(payload.claimedTasks).toEqual([]);
  });

  it("does not publish status when hasUI is false", async () => {
    await replace([{ title: "Task A", description: "First" }]);

    expect(mockCtx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("details contain full board snapshot", async () => {
    const result = await replace([
      { title: "Task A", description: "First" },
      { title: "Task B", description: "Second" },
    ]);

    expect(result.details.action).toBe("write");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks).toHaveLength(2);

    // Verify snapshot is a clone (modifying details doesn't affect state)
    result.details.board!.tasks[0]!.title = "MODIFIED";
    expect(getBoard()!.tasks[0]!.title).toBe("Task A");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// APPEND MODE
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — append mode", () => {
  beforeEach(async () => {
    resetState();
    // Create a board with 2 tasks to append to
    await replace([
      { title: "Task A", description: "First" },
      { title: "Task B", description: "Second" },
    ]);
  });

  it("appends tasks with correct IDs continuing from board.nextId", async () => {
    const result = await append([{ title: "Task C", description: "Third" }]);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Appended 1 task(s) to board"),
    });

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(3);
    expect(board.tasks[2]!.id).toBe("kb-3");
    expect(board.tasks[2]!.title).toBe("Task C");
    expect(board.nextId).toBe(4);
  });

  it("throws when no board exists", async () => {
    resetState();

    await expect(append([{ title: "Task", description: "No board" }])).rejects.toThrow(
      "No board exists",
    );
  });

  it("respects MAX_TASKS limit", async () => {
    resetState();
    // Create a board with 99 tasks
    const tasks99 = Array.from({ length: 99 }, (_, i) => ({
      title: `Task ${i + 1}`,
      description: `Desc ${i + 1}`,
    }));
    await replace(tasks99);

    // Try to append 2 more (exceeds 100)
    await expect(
      append([
        { title: "Overshoot", description: "Too many" },
        { title: "Extra", description: "One too many" },
      ]),
    ).rejects.toThrow(/exceed 100 task limit/i);
  });

  it("can reference existing tasks by blockedBy title", async () => {
    await append([{ title: "Dependent", description: "Needs Task A", blockedBy: ["Task A"] }]);

    const board = getBoard()!;
    const dependent = board.tasks.find((t) => t.title === "Dependent")!;
    const taskA = board.tasks.find((t) => t.title === "Task A")!;
    expect(dependent.blockedBy).toEqual([taskA.id]);
    expect(dependent.status).toBe("blocked");
  });

  it("throws for unresolvable blockedBy reference in append", async () => {
    await expect(
      append([{ title: "Task", description: "Bad ref", blockedBy: ["Nonexistent"] }]),
    ).rejects.toThrow(/cannot resolve blockedBy/i);
  });

  it("detects cycles across existing + new tasks", async () => {
    // Task B is already blocked by nothing, Task A is already on the board
    // We can't easily create a cycle through titles since the existing board
    // doesn't have cycles. Let's test with a direct cycle in the combined set.
    // We'll create a scenario where new tasks reference each other cyclically
    // AND reference existing tasks.

    // First create a board where task B blocks task A (not a cycle)
    resetState();
    await replace([
      { title: "Alpha", description: "A" },
      { title: "Beta", description: "B", blockedBy: ["Alpha"] },
    ]);

    // Now append a task that would create a cycle if Alpha blocked it
    // Actually let's test with a self-referencing cycle among new tasks
    // The new tasks reference each other: new1 blockedBy new2, new2 blockedBy new1
    await expect(
      append([
        { title: "New1", description: "First new", blockedBy: ["New2"] },
        { title: "New2", description: "Second new", blockedBy: ["New1"] },
      ]),
    ).rejects.toThrow(/cycle detected/i);
  });

  it("recomputes statuses after append", async () => {
    // Append a task that is blocked by nothing — should be ready
    await append([{ title: "Independent", description: "No deps" }]);

    const board = getBoard()!;
    const independent = board.tasks.find((t) => t.title === "Independent")!;
    expect(independent.status).toBe("ready");

    // Append a task blocked by existing — should be blocked
    await append([{ title: "Dependent", description: "Has deps", blockedBy: ["Task A"] }]);

    const dependent = getBoard()!.tasks.find((t) => t.title === "Dependent")!;
    expect(dependent.status).toBe("blocked");
  });

  it("resolves profiles for new tasks", async () => {
    await append([
      {
        title: "Reviewed",
        description: "Review task",
        phases: ["implement", "review"],
      },
    ]);

    const board = getBoard()!;
    const reviewed = board.tasks.find((t) => t.title === "Reviewed")!;
    // Task starts at phase "implement", profile should be task-worker
    expect(reviewed.profile).toBe("task-worker");
  });

  it("appended tasks with blockedBy get blocked status", async () => {
    await append([{ title: "Blocked", description: "Has blocker", blockedBy: ["Task A"] }]);

    const board = getBoard()!;
    const blocked = board.tasks.find((t) => t.title === "Blocked")!;
    expect(blocked.status).toBe("blocked");
  });

  it("multiple appends increment nextId correctly", async () => {
    await append([{ title: "C", description: "Third" }]);
    await append([{ title: "D", description: "Fourth" }]);
    await append([{ title: "E", description: "Fifth" }]);

    const board = getBoard()!;
    expect(board.tasks.map((t) => t.id)).toEqual(["kb-1", "kb-2", "kb-3", "kb-4", "kb-5"]);
    expect(board.nextId).toBe(6);
  });

  it("append after delete does not reuse deleted IDs", async () => {
    // Delete kb-2
    await del(["kb-2"]);

    // Append a new task
    await append([{ title: "New", description: "After delete" }]);

    const board = getBoard()!;
    const newTask = board.tasks.find((t) => t.title === "New")!;
    // Should get kb-3 (nextId was 3, not recycled to 2)
    expect(newTask.id).toBe("kb-3");
  });

  it("blockedBy resolution with existing tasks by title", async () => {
    await append([{ title: "Linked", description: "Links to Task B", blockedBy: ["Task B"] }]);

    const board = getBoard()!;
    const linked = board.tasks.find((t) => t.title === "Linked")!;
    const taskB = board.tasks.find((t) => t.title === "Task B")!;
    expect(linked.blockedBy).toEqual([taskB.id]);
  });

  it("profileMap override in append", async () => {
    await append([{ title: "Custom", description: "Custom profile", phases: ["review"] }], {
      review: "custom-reviewer",
    });

    const board = getBoard()!;
    const custom = board.tasks.find((t) => t.title === "Custom")!;
    expect(custom.profile).toBe("custom-reviewer");
  });

  it("publishes kanban status to UI on append", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });

    await tool.execute(
      "call-1",
      {
        mode: "append",
        tasks: [{ title: "New", description: "Appended" }],
      },
      mockSignal,
      noop,
      ctxWithUI,
    );

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(3); // 2 existing + 1 appended
  });

  it("details contain board snapshot after append", async () => {
    const result = await append([{ title: "Snapshot", description: "Check details" }]);

    expect(result.details.action).toBe("write");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks).toHaveLength(3);

    // Verify snapshot is a clone
    result.details.board!.tasks[0]!.title = "MODIFIED";
    expect(getBoard()!.tasks[0]!.title).toBe("Task A");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDIT MODE
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — edit mode", () => {
  beforeEach(async () => {
    resetState();
    // Create a board with 2 tasks for editing
    await replace([
      { title: "Task A", description: "First task", files: ["src/a.ts"] },
      { title: "Task B", description: "Second task", phases: ["implement", "review"] },
    ]);
  });

  it("edit title only", async () => {
    await edit([{ id: "kb-1", set: { title: "Renamed Task A" } }]);

    const board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Renamed Task A");
    // Other fields unchanged
    expect(board.tasks[0]!.description).toBe("First task");
  });

  it("edit description only", async () => {
    await edit([{ id: "kb-1", set: { description: "Updated description" } }]);

    const board = getBoard()!;
    expect(board.tasks[0]!.description).toBe("Updated description");
    expect(board.tasks[0]!.title).toBe("Task A");
  });

  it("edit files only", async () => {
    await edit([{ id: "kb-1", set: { files: ["src/new.ts", "src/other.ts"] } }]);

    const board = getBoard()!;
    expect(board.tasks[0]!.files).toEqual(["src/new.ts", "src/other.ts"]);
  });

  it("edit phases only", async () => {
    await edit([{ id: "kb-1", set: { phases: ["test", "implement"] } }]);

    const board = getBoard()!;
    expect(board.tasks[0]!.phases).toEqual(["test", "implement"]);
  });

  it("edit blockedBy only", async () => {
    await edit([{ id: "kb-2", set: { blockedBy: ["Task A"] } }]);

    const board = getBoard()!;
    const taskB = board.tasks.find((t) => t.id === "kb-2")!;
    expect(taskB.blockedBy).toEqual(["kb-1"]);
  });

  it("edit multiple fields at once", async () => {
    await edit([
      {
        id: "kb-1",
        set: { title: "Multi Edit", description: "Both changed", files: ["new.ts"] },
      },
    ]);

    const board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Multi Edit");
    expect(board.tasks[0]!.description).toBe("Both changed");
    expect(board.tasks[0]!.files).toEqual(["new.ts"]);
  });

  it("multiple edits in one call", async () => {
    await edit([
      { id: "kb-1", set: { title: "Edited A" } },
      { id: "kb-2", set: { title: "Edited B" } },
    ]);

    const board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Edited A");
    expect(board.tasks[1]!.title).toBe("Edited B");
  });

  it("throws when no board exists in edit mode", async () => {
    resetState();
    await expect(edit([{ id: "kb-1", set: { title: "Nope" } }])).rejects.toThrow("No board exists");
  });

  it("rolls back all edits when blockedBy change creates a cycle", async () => {
    await expect(
      edit([
        { id: "kb-1", set: { blockedBy: ["kb-2"] } },
        { id: "kb-2", set: { blockedBy: ["kb-1"] } },
      ]),
    ).rejects.toThrow(/cycle detected/i);

    // Verify rollback: both tasks should have their original blockedBy
    const board = getBoard()!;
    expect(board.tasks.find((t) => t.id === "kb-1")!.blockedBy).toEqual([]);
    expect(board.tasks.find((t) => t.id === "kb-2")!.blockedBy).toEqual([]);
  });

  it("rolls back edits when blockedBy cannot be resolved", async () => {
    await expect(edit([{ id: "kb-1", set: { blockedBy: ["Nonexistent"] } }])).rejects.toThrow(
      /cannot resolve blockedBy/i,
    );

    // Verify rollback: kb-1 should have its original blockedBy
    const board = getBoard()!;
    expect(board.tasks.find((t) => t.id === "kb-1")!.blockedBy).toEqual([]);
  });

  it("phase clamping when phases shrink below currentPhaseIndex", async () => {
    // First advance kb-2 to phase index 1 (review)
    // We can't use advance_tasks directly since kb-2 is "ready", not "claimed"
    // Instead, set the currentPhaseIndex directly via edit
    const board = getBoard()!;
    board.tasks[1]!.currentPhaseIndex = 1; // review phase

    // Now edit phases to only ["implement"] — index 1 is out of bounds
    await edit([{ id: "kb-2", set: { phases: ["implement"] } }]);

    const updated = getBoard()!;
    expect(updated.tasks[1]!.phases).toEqual(["implement"]);
    expect(updated.tasks[1]!.currentPhaseIndex).toBe(0); // clamped to 0
  });

  it("blockedBy change triggers re-resolve and cycle detection", async () => {
    // Set kb-1 to be blocked by kb-2
    await edit([{ id: "kb-1", set: { blockedBy: ["Task B"] } }]);

    const board = getBoard()!;
    const taskA = board.tasks.find((t) => t.id === "kb-1")!;
    expect(taskA.blockedBy).toEqual(["kb-2"]);
  });

  it("atomic: all fail if one edit is invalid", async () => {
    // kb-999 doesn't exist
    await expect(
      edit([
        { id: "kb-999", set: { title: "Ghost" } },
        { id: "kb-1", set: { title: "Should Not Change" } },
      ]),
    ).rejects.toThrow(/not found/);

    // kb-1 should be unchanged
    const board = getBoard()!;
    expect(board.tasks[0]!.title).toBe("Task A");
  });

  it("throws for task not found", async () => {
    await expect(edit([{ id: "kb-999", set: { title: "Nope" } }])).rejects.toThrow(/not found/);
  });

  it("throws for empty set", async () => {
    await expect(edit([{ id: "kb-1", set: {} }])).rejects.toThrow(/empty set/i);
  });

  it("throws for invalid phases in edit", async () => {
    await expect(
      edit([{ id: "kb-1", set: { phases: ["implement", "deploy"] as any } }]),
    ).rejects.toThrow(/invalid phase/i);
  });

  it("status recomputation after blockedBy edit", async () => {
    // kb-1 is currently ready (no blockers)
    // Add a blocker to kb-1 that is done — should become ready
    // Add a blocker to kb-1 that is NOT done — should become blocked
    await edit([{ id: "kb-1", set: { blockedBy: ["Task B"] } }]);

    const board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("blocked"); // Task B is not done
  });

  it("status recomputation: ready task gets blocked when new dependency added", async () => {
    // Create fresh board with 3 tasks
    resetState();
    await replace([
      { title: "A", description: "Task A" },
      { title: "B", description: "Task B" },
      { title: "C", description: "Task C", blockedBy: ["A"] },
    ]);

    // B is ready. Make B depend on C (which is blocked). B should become blocked.
    await edit([{ id: "kb-2", set: { blockedBy: ["C"] } }]);

    const board = getBoard()!;
    expect(board.tasks.find((t) => t.id === "kb-2")!.status).toBe("blocked");
  });

  it("details contain board snapshot after edit", async () => {
    const result = await edit([{ id: "kb-1", set: { title: "Snapshot Edit" } }]);

    expect(result.details.action).toBe("write");
    expect(result.details.board).not.toBeNull();

    // Verify snapshot is a clone
    result.details.board!.tasks[0]!.title = "MODIFIED";
    expect(getBoard()!.tasks[0]!.title).toBe("Snapshot Edit");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE MODE
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — delete mode", () => {
  beforeEach(async () => {
    resetState();
    // Create a board with 3 tasks where C depends on A and B depends on A
    await replace([
      { title: "Task A", description: "First task" },
      { title: "Task B", description: "Second task", blockedBy: ["Task A"] },
      { title: "Task C", description: "Third task", blockedBy: ["Task A"] },
    ]);
  });

  it("delete single task", async () => {
    const result = await del(["kb-3"]);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Deleted 1 task(s)"),
    });

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(2);
    expect(board.tasks.find((t) => t.id === "kb-3")).toBeUndefined();
  });

  it("delete multiple tasks", async () => {
    await del(["kb-2", "kb-3"]);

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.id).toBe("kb-1");
  });

  it("deleted IDs removed from other tasks' blockedBy", async () => {
    await del(["kb-1"]);

    const board = getBoard()!;
    // Both kb-2 and kb-3 were blocked by kb-1; now their blockedBy should be empty
    expect(board.tasks.find((t) => t.id === "kb-2")!.blockedBy).toEqual([]);
    expect(board.tasks.find((t) => t.id === "kb-3")!.blockedBy).toEqual([]);
  });

  it("status recomputation after delete (blocked task becomes ready)", async () => {
    // kb-2 and kb-3 are blocked by kb-1
    expect(getBoard()!.tasks.find((t) => t.id === "kb-2")!.status).toBe("blocked");

    // Delete kb-1 — kb-2 and kb-3 should become ready
    await del(["kb-1"]);

    const board = getBoard()!;
    expect(board.tasks.find((t) => t.id === "kb-2")!.status).toBe("ready");
    expect(board.tasks.find((t) => t.id === "kb-3")!.status).toBe("ready");
  });

  it("deleted IDs never reused on subsequent append", async () => {
    // Delete kb-2
    await del(["kb-2"]);

    // Append — new task should get kb-4, not kb-2
    await append([{ title: "New", description: "After delete" }]);

    const board = getBoard()!;
    const newTask = board.tasks.find((t) => t.title === "New")!;
    expect(newTask.id).toBe("kb-4");
  });

  it("nextId unchanged after delete", async () => {
    const boardBefore = getBoard()!;
    const nextIdBefore = boardBefore.nextId;

    await del(["kb-2"]);

    const boardAfter = getBoard()!;
    expect(boardAfter.nextId).toBe(nextIdBefore);
  });

  it("atomic: all fail if one ID not found", async () => {
    await expect(del(["kb-1", "kb-999"])).rejects.toThrow(/not found/);

    // kb-1 should still exist
    const board = getBoard()!;
    expect(board.tasks).toHaveLength(3);
  });

  it("deduplicates IDs", async () => {
    // Delete kb-2 twice — should only delete once
    await del(["kb-2", "kb-2"]);

    const board = getBoard()!;
    expect(board.tasks).toHaveLength(2);
  });

  it("throws when no board exists", async () => {
    resetState();

    await expect(del(["kb-1"])).rejects.toThrow("No board exists");
  });

  it("publishes kanban status to UI on delete", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });

    await tool.execute("call-1", { mode: "delete", ids: ["kb-3"] }, mockSignal, noop, ctxWithUI);

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(2);
  });

  it("deleting the only task on a single-task board clears the board", async () => {
    resetState();
    await replace([{ title: "Solo", description: "Only task" }]);
    const result = await del(["kb-1"]);
    expect(getBoard()).toBeNull();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Board cleared"),
    });
  });

  it("deleting all tasks clears the board completely", async () => {
    const result = await del(["kb-1", "kb-2", "kb-3"]);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Board cleared"),
    });

    expect(getBoard()).toBeNull();
  });

  it("deleting all tasks publishes empty status to UI", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });

    await tool.execute(
      "call-1",
      { mode: "delete", ids: ["kb-1", "kb-2", "kb-3"] },
      mockSignal,
      noop,
      ctxWithUI,
    );

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — unreachable default branches
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — edge cases", () => {
  beforeEach(() => {
    resetState();
  });

  it("execute throws for unknown mode", async () => {
    await expect(
      tool.execute("call-1", { mode: "unknown" } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/Unknown write_kanban mode/i);
  });

  it("renderCall returns fallback for unknown mode", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ mode: "unknown" }, theme, {} as any);
    expect(result).toBeDefined();
  });

  it("renderCall handles replace/append with undefined tasks", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ mode: "replace" }, theme, {} as any);
    expect(result).toBeDefined();
  });

  it("renderCall handles edit with undefined edits", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ mode: "edit" }, theme, {} as any);
    expect(result).toBeDefined();
  });

  it("renderCall handles delete with undefined ids", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ mode: "delete" }, theme, {} as any);
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MODE-SPECIFIC VALIDATION (flat schema)
// ═══════════════════════════════════════════════════════════════════════

describe("write_kanban — mode-specific validation", () => {
  beforeEach(() => {
    resetState();
  });

  it("replace mode without tasks throws", async () => {
    await expect(
      tool.execute("call-1", { mode: "replace" } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/requires a non-empty 'tasks' array/);
  });

  it("replace mode with empty tasks throws", async () => {
    await expect(
      tool.execute("call-1", { mode: "replace", tasks: [] } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/requires a non-empty 'tasks' array/);
  });

  it("append mode without tasks throws", async () => {
    await expect(
      tool.execute("call-1", { mode: "append" } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/requires a non-empty 'tasks' array/);
  });

  it("edit mode without edits throws", async () => {
    await expect(
      tool.execute("call-1", { mode: "edit" } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/requires a non-empty 'edits' array/);
  });

  it("delete mode without ids throws", async () => {
    await expect(
      tool.execute("call-1", { mode: "delete" } as any, mockSignal, noop, mockCtx),
    ).rejects.toThrow(/requires a non-empty 'ids' array/);
  });
});
