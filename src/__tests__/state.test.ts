import { describe, it, expect, beforeEach } from "vitest";
import {
  getBoard,
  setBoard,
  resetState,
  getTaskById,
  getTasksByStatus,
  recomputeStatuses,
} from "../state";
import { resolveBlockedByTitles } from "../resolve-deps";
import { resolveTaskProfile } from "../resolve-profile";
import { reconstructState } from "../reconstruct";
import { makeTask, makeBoard } from "./helpers/test-helpers";
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
    const taskA = makeTask({ id: "kb-1", title: "Setup database" });
    const taskB = makeTask({
      id: "kb-2",
      title: "Write queries",
      blockedBy: ["Setup database"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result).toEqual({ success: true });
    expect(taskB.blockedBy).toEqual(["kb-1"]);
  });

  it("returns error for unresolvable references", () => {
    const taskA = makeTask({ id: "kb-1", title: "Setup database" });
    const taskB = makeTask({
      id: "kb-2",
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
    const taskA = makeTask({ id: "kb-1", title: "Setup database" });
    const taskB = makeTask({
      id: "kb-2",
      title: "Write queries",
      blockedBy: ["kb-1"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result).toEqual({ success: true });
    expect(taskB.blockedBy).toEqual(["kb-1"]);
  });

  it("handles task with empty blockedBy", () => {
    const task = makeTask({ id: "kb-1", blockedBy: [] });
    const result = resolveBlockedByTitles([task]);
    expect(result).toEqual({ success: true });
    expect(task.blockedBy).toEqual([]);
  });

  it("resolves multiple mixed references", () => {
    const taskA = makeTask({ id: "kb-1", title: "Task A" });
    const taskB = makeTask({ id: "kb-2", title: "Task B" });
    const taskC = makeTask({
      id: "kb-3",
      title: "Task C",
      blockedBy: ["Task A", "kb-2"],
    });

    const result = resolveBlockedByTitles([taskA, taskB, taskC]);
    expect(result).toEqual({ success: true });
    expect(taskC.blockedBy).toEqual(["kb-1", "kb-2"]);
  });

  it("does not treat a non-kb-N non-title string as resolved", () => {
    const taskA = makeTask({ id: "kb-1", title: "Task A" });
    const taskB = makeTask({
      id: "kb-2",
      blockedBy: ["not-a-kb-id-and-not-a-title"],
    });

    const result = resolveBlockedByTitles([taskA, taskB]);
    expect(result.success).toBe(false);
  });
});

// ── recomputeStatuses ─────────────────────────────────────────────

describe("recomputeStatuses", () => {
  it("blocked task whose deps are all done → becomes ready", () => {
    const taskA = makeTask({ id: "kb-1", status: "done" });
    const taskB = makeTask({ id: "kb-2", status: "blocked", blockedBy: ["kb-1"] });
    const board = makeBoard([taskA, taskB]);
    recomputeStatuses(board);
    expect(taskB.status).toBe("ready");
  });

  it("blocked task with incomplete deps → stays blocked", () => {
    const taskA = makeTask({ id: "kb-1", status: "ready" });
    const taskB = makeTask({ id: "kb-2", status: "blocked", blockedBy: ["kb-1"] });
    const board = makeBoard([taskA, taskB]);
    recomputeStatuses(board);
    expect(taskB.status).toBe("blocked");
  });

  it("ready task with no deps → stays ready", () => {
    const task = makeTask({ id: "kb-1", status: "ready", blockedBy: [] });
    const board = makeBoard([task]);
    recomputeStatuses(board);
    expect(task.status).toBe("ready");
  });

  it("ready task that now has non-done deps → becomes blocked", () => {
    const taskA = makeTask({ id: "kb-1", status: "ready" });
    const taskB = makeTask({ id: "kb-2", status: "ready", blockedBy: ["kb-1"] });
    const board = makeBoard([taskA, taskB]);
    recomputeStatuses(board);
    expect(taskB.status).toBe("blocked");
  });

  it("claimed task → untouched", () => {
    const taskA = makeTask({ id: "kb-1", status: "done" });
    const taskB = makeTask({ id: "kb-2", status: "claimed", blockedBy: ["kb-1"] });
    const board = makeBoard([taskA, taskB]);
    recomputeStatuses(board);
    expect(taskB.status).toBe("claimed");
  });

  it("done task → untouched", () => {
    const task = makeTask({
      id: "kb-1",
      status: "done",
      currentPhaseIndex: -1,
      blockedBy: ["kb-0"],
    });
    const board = makeBoard([task]);
    recomputeStatuses(board);
    expect(task.status).toBe("done");
  });

  it("empty blockedBy → becomes ready", () => {
    const task = makeTask({ id: "kb-1", status: "blocked", blockedBy: [] });
    const board = makeBoard([task]);
    recomputeStatuses(board);
    expect(task.status).toBe("ready");
  });

  it("mixed board with multiple scenarios", () => {
    const taskA = makeTask({ id: "kb-1", status: "done" });
    const taskB = makeTask({ id: "kb-2", status: "ready", blockedBy: ["kb-1"] });
    // taskB is ready but depends on done task — should stay ready
    const taskC = makeTask({ id: "kb-3", status: "blocked", blockedBy: ["kb-1"] });
    // taskC is blocked but dep is done — should become ready
    const taskD = makeTask({ id: "kb-4", status: "claimed", blockedBy: ["kb-2"] });
    // taskD is claimed — untouched
    const taskE = makeTask({ id: "kb-5", status: "blocked", blockedBy: ["kb-3", "kb-4"] });
    // taskE is blocked, kb-3 will be ready and kb-4 is claimed — stays blocked
    const board = makeBoard([taskA, taskB, taskC, taskD, taskE]);
    recomputeStatuses(board);
    expect(taskA.status).toBe("done");
    expect(taskB.status).toBe("ready");
    expect(taskC.status).toBe("ready");
    expect(taskD.status).toBe("claimed");
    expect(taskE.status).toBe("blocked");
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
              toolName: "write_kanban",
              details: { action: "write" },
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
              toolName: "write_kanban",
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
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [task],
                  profileMap: DEFAULT_PROFILE_MAP,
                  maxClaims: 4,
                  createdAt: 1234567890,
                  nextId: 5,
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
    expect(result!.nextId).toBe(5);
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
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [oldTask],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                  nextId: 2,
                },
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
                board: {
                  tasks: [newTask],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 200,
                  nextId: 3,
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
              toolName: "write_kanban",
              details: {
                action: "write",
                board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100, nextId: 1 },
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
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [validTask, { id: "" }, { notATask: true }],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                  nextId: 2,
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
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [{ id: "" }, { notATask: true }],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                  nextId: 1,
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
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "write_kanban",
              details: {
                action: "write",
                board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100, nextId: 1 },
              },
            },
          },
          { type: "other", message: null },
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
              toolName: "write_kanban",
              details: {
                action: "write",
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
    // nextId computed from tasks when missing
    const n = parseInt(task.id.slice(3), 10);
    expect(result!.nextId).toBe((Number.isNaN(n) ? 0 : n) + 1);
  });

  it("recognizes all TOOL_NAMES (create, write, list, claim, advance, reject)", () => {
    const toolNames = [
      "write_kanban",
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
                  action: "write",
                  board: { tasks: [task], profileMap: {}, maxClaims: 4, createdAt: 100, nextId: 1 },
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

  it("preserves nextId from raw data when present", () => {
    const task = makeTask({ id: "kb-42" });
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [task],
                  profileMap: {},
                  maxClaims: 4,
                  createdAt: 100,
                  nextId: 99,
                },
              },
            },
          },
        ],
      },
    });

    const result = reconstructState(ctx);
    expect(result).not.toBeNull();
    expect(result!.nextId).toBe(99);
  });

  it("computes nextId from tasks when missing", () => {
    const task = makeTask({ id: "kb-7" });
    const ctx = createMockContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "write_kanban",
              details: {
                action: "write",
                board: {
                  tasks: [task],
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
    expect(result!.nextId).toBe(8); // max kb-7 → 7, +1 = 8
  });
});
