import { describe, it, expect, beforeEach } from "vitest";
import {
  getBoard,
  setBoard,
  resetState,
  getTaskById,
  getTasksByStatus,
  resolveBlockedByTitles,
  computeInitialStatuses,
  unblockDependents,
  resolveTaskProfile,
  reconstructState,
} from "../state";
import { makeTask, makeBoard } from "./helpers/test-data";
import { createMockContext } from "./helpers/mock-api";
import { DEFAULT_PROFILE_MAP } from "../types";

// ── getBoard / setBoard / resetState ─────────────────────────────────

describe("state management — getBoard / setBoard / resetState", () => {
  beforeEach(() => {
    resetState();
  });

  it("initially returns null", () => {
    expect(getBoard()).toBeNull();
  });

  it("after setBoard, returns the board", () => {
    const board = makeBoard([makeTask()]);
    setBoard(board);
    expect(getBoard()).toBe(board);
  });

  it("after resetState, returns null", () => {
    const board = makeBoard([makeTask()]);
    setBoard(board);
    resetState();
    expect(getBoard()).toBeNull();
  });

  it("setBoard replaces previous board", () => {
    const board1 = makeBoard([makeTask({ id: "task-1" })]);
    const board2 = makeBoard([makeTask({ id: "task-2" })]);
    setBoard(board1);
    setBoard(board2);
    expect(getBoard()).toBe(board2);
  });
});

// ── getTaskById ──────────────────────────────────────────────────────

describe("getTaskById", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns task when ID exists", () => {
    const task = makeTask({ id: "known-id" });
    setBoard(makeBoard([task]));
    expect(getTaskById("known-id")).toBe(task);
  });

  it("returns undefined when ID doesn't exist", () => {
    setBoard(makeBoard([makeTask({ id: "other-id" })]));
    expect(getTaskById("missing-id")).toBeUndefined();
  });

  it("returns undefined when no board is set", () => {
    expect(getTaskById("any-id")).toBeUndefined();
  });
});

// ── getTasksByStatus ─────────────────────────────────────────────────

describe("getTasksByStatus", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns only matching status", () => {
    const ready1 = makeTask({ id: "r1", status: "ready" });
    const ready2 = makeTask({ id: "r2", status: "ready" });
    const blocked = makeTask({ id: "b1", status: "blocked" });
    const done = makeTask({ id: "d1", status: "done" });
    setBoard(makeBoard([ready1, blocked, ready2, done]));

    const result = getTasksByStatus("ready");
    expect(result).toHaveLength(2);
    expect(result).toEqual([ready1, ready2]);
  });

  it("returns empty array when none match", () => {
    setBoard(makeBoard([makeTask({ status: "ready" })]));
    expect(getTasksByStatus("done")).toEqual([]);
  });

  it("returns empty array when no board is set", () => {
    expect(getTasksByStatus("ready")).toEqual([]);
  });
});

// ── resolveBlockedByTitles ───────────────────────────────────────────

describe("resolveBlockedByTitles", () => {
  it("resolves title references to IDs", () => {
    const taskA = makeTask({ id: "00000000-0000-0000-0000-000000000001", title: "Setup database" });
    const taskB = makeTask({
      id: "00000000-0000-0000-0000-000000000002",
      title: "Write queries",
      blockedBy: ["Setup database"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result).toEqual({ success: true });
    expect(taskB.blockedBy).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("returns error for unresolvable references", () => {
    const taskA = makeTask({ id: "00000000-0000-0000-0000-000000000001", title: "Setup database" });
    const taskB = makeTask({
      id: "00000000-0000-0000-0000-000000000002",
      title: "Write queries",
      blockedBy: ["Nonexistent task"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result).toEqual({ success: false, error: expect.any(String) });
    if (!result.success) {
      expect(result.error).toContain("Nonexistent task");
    }
  });

  it("leaves already-resolved IDs unchanged", () => {
    const taskA = makeTask({ id: "00000000-0000-0000-0000-000000000001", title: "Setup database" });
    const taskB = makeTask({
      id: "00000000-0000-0000-0000-000000000002",
      title: "Write queries",
      blockedBy: ["00000000-0000-0000-0000-000000000001"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result).toEqual({ success: true });
    expect(taskB.blockedBy).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("handles task with empty blockedBy", () => {
    const task = makeTask({ id: "00000000-0000-0000-0000-000000000001", blockedBy: [] });
    const result = resolveBlockedByTitles([task]);
    expect(result).toEqual({ success: true });
    expect(task.blockedBy).toEqual([]);
  });

  it("resolves multiple mixed references", () => {
    const taskA = makeTask({ id: "00000000-0000-0000-0000-000000000001", title: "Task A" });
    const taskB = makeTask({ id: "00000000-0000-0000-0000-000000000002", title: "Task B" });
    const taskC = makeTask({
      id: "00000000-0000-0000-0000-000000000003",
      title: "Task C",
      blockedBy: ["Task A", "00000000-0000-0000-0000-000000000002"],
    });

    const result = resolveBlockedByTitles([taskA, taskB, taskC]);
    expect(result).toEqual({ success: true });
    expect(taskC.blockedBy).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
    ]);
  });

  it("does not treat a non-UUID non-title string as resolved", () => {
    const taskA = makeTask({ id: "00000000-0000-0000-0000-000000000001", title: "Task A" });
    const taskB = makeTask({
      id: "00000000-0000-0000-0000-000000000002",
      blockedBy: ["not-a-uuid-and-not-a-title"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result.success).toBe(false);
  });
});

// ── computeInitialStatuses ───────────────────────────────────────────

describe("computeInitialStatuses", () => {
  it('tasks with empty blockedBy get "ready"', () => {
    const task = makeTask({ blockedBy: [], status: "blocked" });
    const board = makeBoard([task]);
    computeInitialStatuses(board);
    expect(task.status).toBe("ready");
  });

  it('tasks with blockedBy entries get "blocked"', () => {
    const task = makeTask({ blockedBy: ["some-id"], status: "ready" });
    const board = makeBoard([task]);
    computeInitialStatuses(board);
    expect(task.status).toBe("blocked");
  });

  it("handles mixed tasks", () => {
    const ready = makeTask({ id: "r1", blockedBy: [], status: "blocked" });
    const blocked = makeTask({ id: "b1", blockedBy: ["r1"], status: "ready" });
    const board = makeBoard([ready, blocked]);
    computeInitialStatuses(board);
    expect(ready.status).toBe("ready");
    expect(blocked.status).toBe("blocked");
  });
});

// ── unblockDependents ────────────────────────────────────────────────

describe("unblockDependents", () => {
  beforeEach(() => {
    resetState();
  });

  it("when blocking task reaches done, dependent tasks become ready", () => {
    const taskA = makeTask({ id: "A", status: "done" });
    const taskB = makeTask({ id: "B", status: "blocked", blockedBy: ["A"] });
    setBoard(makeBoard([taskA, taskB]));

    unblockDependents("A");
    expect(taskB.status).toBe("ready");
  });

  it("tasks with multiple blockers only unblock when ALL are done", () => {
    const taskA = makeTask({ id: "A", status: "done" });
    const taskB = makeTask({ id: "B", status: "done" });
    const taskC = makeTask({ id: "C", status: "blocked", blockedBy: ["A", "B"] });

    // Only A is done — C stays blocked
    setBoard(makeBoard([taskA, makeTask({ id: "B", status: "ready" }), taskC]));
    unblockDependents("A");
    expect(taskC.status).toBe("blocked");

    // Now both A and B are done — C unblocks
    setBoard(makeBoard([taskA, taskB, taskC]));
    unblockDependents("B");
    expect(taskC.status).toBe("ready");
  });

  it("does not modify non-blocked tasks", () => {
    const taskA = makeTask({ id: "A", status: "done" });
    const taskB = makeTask({ id: "B", status: "claimed", blockedBy: ["A"] });
    setBoard(makeBoard([taskA, taskB]));

    unblockDependents("A");
    expect(taskB.status).toBe("claimed");
  });

  it("handles tasks with no blockedBy becoming ready", () => {
    const taskA = makeTask({ id: "A", status: "done" });
    const taskB = makeTask({ id: "B", status: "blocked", blockedBy: [] });
    setBoard(makeBoard([taskA, taskB]));

    unblockDependents("A");
    expect(taskB.status).toBe("ready");
  });

  it("does nothing when no board is set", () => {
    // Should not throw
    expect(() => {
      unblockDependents("some-id");
    }).not.toThrow();
  });
});

// ── resolveTaskProfile ───────────────────────────────────────────────

describe("resolveTaskProfile", () => {
  it("returns mapped profile for current phase", () => {
    const task = makeTask({
      phases: ["test", "implement"],
      currentPhaseIndex: 0,
    });
    const result = resolveTaskProfile(task, DEFAULT_PROFILE_MAP);
    expect(result).toBe("task-worker-tests");
  });

  it("returns mapped profile for implement phase", () => {
    const task = makeTask({
      phases: ["test", "implement"],
      currentPhaseIndex: 1,
    });
    const result = resolveTaskProfile(task, DEFAULT_PROFILE_MAP);
    expect(result).toBe("task-worker");
  });

  it("returns empty string for done tasks (currentPhaseIndex === -1)", () => {
    const task = makeTask({ currentPhaseIndex: -1, status: "done" });
    const result = resolveTaskProfile(task, DEFAULT_PROFILE_MAP);
    expect(result).toBe("");
  });

  it("returns empty string when currentPhaseIndex >= phases.length", () => {
    const task = makeTask({
      phases: ["implement"],
      currentPhaseIndex: 5,
    });
    const result = resolveTaskProfile(task, DEFAULT_PROFILE_MAP);
    expect(result).toBe("");
  });

  it("uses custom profileMap when provided", () => {
    const task = makeTask({
      phases: ["implement"],
      currentPhaseIndex: 0,
    });
    const customMap = { implement: "my-custom-worker" };
    const result = resolveTaskProfile(task, customMap);
    expect(result).toBe("my-custom-worker");
  });

  it("falls back to DEFAULT_PROFILE_MAP then 'task-worker'", () => {
    const task = makeTask({
      phases: ["implement"],
      currentPhaseIndex: 0,
    });
    // Empty profileMap — should fall back through DEFAULT_PROFILE_MAP
    const result = resolveTaskProfile(task, {});
    expect(result).toBe("task-worker");
  });
});

// ── reconstructState ─────────────────────────────────────────────────

describe("reconstructState", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns null when no branch entries", () => {
    const ctx = createMockContext();
    expect(reconstructState(ctx)).toBeNull();
  });

  it("returns null when branch has no matching tool results", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "other_tool",
              details: { board: { tasks: [makeTask()] } },
            },
          },
        ],
      },
    });
    expect(reconstructState(ctx)).toBeNull();
  });

  it("returns null when details has no board field", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: { action: "create" },
            },
          },
        ],
      },
    });
    expect(reconstructState(ctx)).toBeNull();
  });

  it("returns null when board.tasks is not an array", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: { board: { tasks: "not-array" } },
            },
          },
        ],
      },
    });
    expect(reconstructState(ctx)).toBeNull();
  });

  it("returns null when board.tasks is empty", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "list_kanban",
              details: { board: { tasks: [] } },
            },
          },
        ],
      },
    });
    expect(reconstructState(ctx)).toBeNull();
  });

  it("reconstructs board from valid tool result details", () => {
    const task = makeTask();
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: {
                  tasks: [task],
                  profileMap: DEFAULT_PROFILE_MAP,
                  maxClaims: 4,
                  createdAt: 1234567890,
                },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0]!.id).toBe(task.id);
    expect(result!.profileMap).toEqual(DEFAULT_PROFILE_MAP);
    expect(result!.maxClaims).toBe(4);
    expect(result!.createdAt).toBe(1234567890);
  });

  it("uses most recent valid entry (reverse scan)", () => {
    const oldTask = makeTask({ id: "old-task" });
    const newTask = makeTask({ id: "new-task" });
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: { tasks: [oldTask], profileMap: {}, maxClaims: 4, createdAt: 100 },
              },
            },
          },
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "advance_tasks",
              details: {
                action: "advance",
                board: { tasks: [newTask], profileMap: {}, maxClaims: 4, createdAt: 200 },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0]!.id).toBe("new-task");
  });

  it("deep clones the result", () => {
    const task = makeTask({ id: "clone-test" });
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100 },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    // Modifying the result should not affect the original branch data
    result!.tasks[0]!.title = "Modified";
    // The original task in the branch data should be unaffected
    expect(task.title).toBe("Test task");
  });

  it("filters out invalid tasks from board", () => {
    const validTask = makeTask({ id: "valid-1" });
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: {
                  tasks: [validTask, { id: "" }, { notATask: true }],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0]!.id).toBe("valid-1");
  });

  it("returns null when all tasks are invalid", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: {
                  tasks: [{ id: "" }, { notATask: true }],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                },
              },
            },
          },
        ],
      },
    });

    expect(reconstructState(ctx)).toBeNull();
  });

  it("skips non-message entries", () => {
    const task = makeTask();
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          { type: "other", message: null },
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100 },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.tasks[0]!.id).toBe(task.id);
  });

  it("skips entries with non-toolResult role", () => {
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              content: "hello",
            },
          },
        ],
      },
    });

    expect(reconstructState(ctx)).toBeNull();
  });

  it("uses defaults for missing board fields", () => {
    const task = makeTask();
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "create_kanban",
              details: {
                action: "create",
                board: { tasks: [task] },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.profileMap).toEqual({});
    expect(result!.maxClaims).toBe(4);
    expect(typeof result!.createdAt).toBe("number");
  });

  it("recognizes all TOOL_NAMES (create, list, claim, advance, reject)", () => {
    const toolNames = [
      "create_kanban",
      "list_kanban",
      "claim_tasks",
      "advance_tasks",
      "reject_tasks",
    ];
    for (const toolName of toolNames) {
      resetState();
      const task = makeTask();
      const ctx = createMockContext({
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: {
                role: "toolResult",
                toolName,
                details: {
                  action: "create",
                  board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100 },
                },
              },
            },
          ],
        },
      });

      const result = reconstructState(ctx);
      expect(result).not.toBeNull();
      expect(result!.tasks[0]!.id).toBe(task.id);
    }
  });
});
