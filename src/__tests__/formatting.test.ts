import { describe, it, expect, beforeEach } from "vitest";
import {
  formatPhaseLabel,
  formatTaskText,
  formatBoardText,
  formatClaimTaskDetail,
  getPhaseIcon,
  renderBoard,
  renderToolResult,
} from "../formatting";
import { makeTask, makeBoard } from "./helpers/test-data";
import { createMockTheme } from "./helpers/mock-api";
import { PHASE_ICONS } from "../types";

// ── formatPhaseLabel ─────────────────────────────────────────────────

describe("formatPhaseLabel", () => {
  it("returns the current phase name", () => {
    const task = makeTask({
      phases: ["test", "implement", "review"],
      currentPhaseIndex: 1,
    });
    expect(formatPhaseLabel(task)).toBe("implement");
  });

  it("returns first phase for index 0", () => {
    const task = makeTask({
      phases: ["implement", "review"],
      currentPhaseIndex: 0,
    });
    expect(formatPhaseLabel(task)).toBe("implement");
  });

  it('returns "done" for currentPhaseIndex === -1', () => {
    const task = makeTask({ currentPhaseIndex: -1, status: "done" });
    expect(formatPhaseLabel(task)).toBe("done");
  });

  it('returns "done" when currentPhaseIndex >= phases.length', () => {
    const task = makeTask({
      phases: ["implement"],
      currentPhaseIndex: 5,
    });
    expect(formatPhaseLabel(task)).toBe("done");
  });

  it("returns last phase name correctly", () => {
    const task = makeTask({
      phases: ["test", "implement", "review"],
      currentPhaseIndex: 2,
    });
    expect(formatPhaseLabel(task)).toBe("review");
  });
});

// ── formatTaskText ───────────────────────────────────────────────────

describe("formatTaskText", () => {
  it("formats a ready task with phase icon, id, and title", () => {
    const task = makeTask({
      id: "kb-1",
      title: "My task",
      phases: ["implement"],
      currentPhaseIndex: 0,
      status: "ready",
    });
    const result = formatTaskText(task);
    expect(result).toBe(`${PHASE_ICONS.implement} [kb-1] My task`);
  });

  it("formats a done task with done phase icon", () => {
    const task = makeTask({
      id: "kb-2",
      title: "Done task",
      currentPhaseIndex: -1,
      status: "done",
    });
    const result = formatTaskText(task);
    expect(result).toBe(`${PHASE_ICONS.done} [kb-2] Done task`);
  });

  it("formats a blocked task with phase icon", () => {
    const task = makeTask({
      id: "aabbccdd",
      title: "Blocked task",
      status: "blocked",
    });
    const result = formatTaskText(task);
    expect(result).toBe(`${PHASE_ICONS.implement} [aabbccdd] Blocked task`);
  });

  it("formats a claimed task with phase icon", () => {
    const task = makeTask({
      id: "a1b2c3d4",
      title: "Claimed task",
      status: "claimed",
    });
    const result = formatTaskText(task);
    expect(result).toBe(`${PHASE_ICONS.implement} [a1b2c3d4] Claimed task`);
  });

  it("appends dependency suffix when blockedBy is non-empty", () => {
    const task = makeTask({
      id: "kb-5",
      title: "Dependent task",
      status: "blocked",
      blockedBy: ["kb-99", "kb-42"],
    });
    const result = formatTaskText(task);
    expect(result).toBe(`${PHASE_ICONS.implement} [kb-5] Dependent task → kb-99, kb-42`);
  });

  it("does not include dependency arrow when blockedBy is empty", () => {
    const task = makeTask({
      id: "kb-6",
      title: "No deps",
      blockedBy: [],
    });
    const result = formatTaskText(task);
    expect(result).not.toContain("→");
  });
});

// ── formatBoardText ──────────────────────────────────────────────────

describe("formatBoardText", () => {
  it('returns "No tasks on the board." for empty board', () => {
    const board = makeBoard([]);
    expect(formatBoardText(board)).toBe("No tasks on the board.");
  });

  it("formats header with correct counts", () => {
    const tasks = [
      makeTask({ id: "r1", status: "ready" }),
      makeTask({ id: "r2", status: "ready" }),
      makeTask({ id: "c1", status: "claimed" }),
      makeTask({ id: "b1", status: "blocked" }),
      makeTask({ id: "d1", status: "done", currentPhaseIndex: -1 }),
    ];
    const board = makeBoard(tasks);
    const result = formatBoardText(board);

    expect(result).toContain("📋 Kanban Board — 5 total, 1 claimed, 2 ready, 1 blocked, 1 done");
  });

  it("groups tasks by status in order: claimed → ready → blocked → done", () => {
    const blocked = makeTask({ id: "b1", status: "blocked" });
    const claimed = makeTask({ id: "c1", status: "claimed" });
    const done = makeTask({ id: "d1", status: "done", currentPhaseIndex: -1 });
    const ready = makeTask({ id: "r1", status: "ready" });

    const board = makeBoard([blocked, claimed, done, ready]);
    const result = formatBoardText(board);

    const claimedIdx = result.indexOf("── CLAIMED ──");
    const readyIdx = result.indexOf("── READY ──");
    const blockedIdx = result.indexOf("── BLOCKED ──");
    const doneIdx = result.indexOf("── DONE ──");

    expect(claimedIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeGreaterThan(claimedIdx);
    expect(blockedIdx).toBeGreaterThan(readyIdx);
    expect(doneIdx).toBeGreaterThan(blockedIdx);
  });

  it("skips status groups with no tasks", () => {
    const board = makeBoard([makeTask({ id: "r1", status: "ready" })]);
    const result = formatBoardText(board);

    expect(result).toContain("── READY ──");
    expect(result).not.toContain("── CLAIMED ──");
    expect(result).not.toContain("── BLOCKED ──");
    expect(result).not.toContain("── DONE ──");
  });

  it("includes formatted tasks under each group", () => {
    const ready = makeTask({ id: "r1", status: "ready", title: "Ready task" });
    const board = makeBoard([ready]);
    const result = formatBoardText(board);

    expect(result).toContain("Ready task");
    expect(result).toContain(PHASE_ICONS.implement);
  });

  it("includes dependency arrow for blocked tasks with blockedBy", () => {
    const blocked = makeTask({
      id: "b1",
      status: "blocked",
      blockedBy: ["kb-10", "kb-20"],
    });
    const board = makeBoard([blocked]);
    const result = formatBoardText(board);

    expect(result).toContain("→ kb-10, kb-20");
  });
});

// ── formatClaimTaskDetail ────────────────────────────────────────────

describe("formatClaimTaskDetail", () => {
  it("formats task detail with all fields", () => {
    const task = makeTask({
      id: "task-123",
      title: "My claimed task",
      phases: ["implement"],
      currentPhaseIndex: 0,
      profile: "task-worker",
      files: ["src/a.ts", "src/b.ts"],
      description: "Do the thing",
    });

    const result = formatClaimTaskDetail(task);
    expect(result).toContain("📌 Task: task-123");
    expect(result).toContain("Title: My claimed task");
    expect(result).toContain("Phase: implement");
    expect(result).toContain("Profile: task-worker");
    expect(result).toContain("📄 src/a.ts");
    expect(result).toContain("📄 src/b.ts");
    expect(result).toContain("Description: Do the thing");
  });

  it("shows (none) when no files", () => {
    const task = makeTask({ files: [] });
    const result = formatClaimTaskDetail(task);
    expect(result).toContain("(none)");
  });

  it("shows done phase for completed task", () => {
    const task = makeTask({ currentPhaseIndex: -1, status: "done" });
    const result = formatClaimTaskDetail(task);
    expect(result).toContain("Phase: done");
  });
});

// ── getPhaseIcon (themed) ───────────────────────────────────────────

describe("getPhaseIcon", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("returns themed icon for known phase", () => {
    getPhaseIcon("implement", mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("text", PHASE_ICONS["implement"]);
  });

  it("returns themed icon for 'done'", () => {
    getPhaseIcon("done", mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("text", PHASE_ICONS["done"]);
  });

  it("returns themed '?' for unknown phase", () => {
    getPhaseIcon("unknown", mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("muted", "?");
  });
});

// ── renderBoard (themed) ────────────────────────────────────────────

describe("renderBoard", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it('calls theme.fg("dim", "No tasks on the board.") for empty board', () => {
    renderBoard(makeBoard([]), mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "No tasks on the board.");
  });

  it("renders themed header with colored counts", () => {
    const tasks = [
      makeTask({ id: "c1", status: "claimed" }),
      makeTask({ id: "r1", status: "ready" }),
      makeTask({ id: "b1", status: "blocked" }),
      makeTask({ id: "d1", status: "done", currentPhaseIndex: -1 }),
    ];
    renderBoard(makeBoard(tasks), mockTheme);

    expect(mockTheme.bold).toHaveBeenCalled();
    expect(mockTheme.fg).toHaveBeenCalledWith("warning", "1 claimed");
    expect(mockTheme.fg).toHaveBeenCalledWith("success", "1 ready");
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "1 blocked");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "1 done");
  });

  it("renders each task with themed phase icon", () => {
    const task = makeTask({
      id: "task-1",
      status: "ready",
      phases: ["implement"],
      currentPhaseIndex: 0,
    });
    renderBoard(makeBoard([task]), mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("text", PHASE_ICONS.implement);
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[task-1]");
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "Test task");
  });

  it("applies strikethrough to done task titles", () => {
    const task = makeTask({ id: "d1", status: "done", currentPhaseIndex: -1, title: "Done task" });
    renderBoard(makeBoard([task]), mockTheme);

    expect(mockTheme.strikethrough).toHaveBeenCalledWith("Done task");
  });

  it("renders phase icon for done tasks", () => {
    const task = makeTask({ id: "d1", status: "done", currentPhaseIndex: -1 });
    renderBoard(makeBoard([task]), mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("text", PHASE_ICONS.done);
  });

  it("renders dependency suffix for blocked tasks with blockedBy", () => {
    const task = makeTask({
      id: "b1",
      status: "blocked",
      blockedBy: ["kb-10", "kb-20"],
    });
    renderBoard(makeBoard([task]), mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("muted", " → kb-10, kb-20");
  });
});

// ── renderToolResult ─────────────────────────────────────────────────

describe("renderToolResult", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("returns Text with content text when no details", () => {
    const result = { content: [{ type: "text", text: "some text" }] };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    const lines = rendered.render(100);
    expect(lines[0]).toBe("some text");
  });

  it("renders error when details.error is set", () => {
    const result = {
      content: [{ type: "text", text: "error message" }],
      details: {
        action: "write" as const,
        board: null,
        error: "something went wrong",
      },
    };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "Error: something went wrong");
    const lines = rendered.render(100);
    expect(lines.join("\n")).toContain("something went wrong");
  });

  it("renders board when details.board is set", () => {
    const task = makeTask({ status: "ready" });
    const result = {
      content: [{ type: "text", text: "ok" }],
      details: {
        action: "write" as const,
        board: makeBoard([task]),
      },
    };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    // Should have called renderBoard internally
    expect(mockTheme.bold).toHaveBeenCalled();
    const lines = rendered.render(100);
    expect(lines.join("\n")).toContain("Kanban Board");
  });

  it('renders "No tasks" when details.board is null and no error', () => {
    const result = {
      content: [{ type: "text", text: "list" }],
      details: {
        action: "list" as const,
        board: null,
      },
    };
    renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "No tasks on the board.");
  });

  it("handles content element with no text property", () => {
    const result = { content: [{ type: "text" }] };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    const lines = rendered.render(100);
    expect(lines).toEqual([]);
  });

  it("handles empty content array", () => {
    const result = { content: [] };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme, {});
    const lines = rendered.render(100);
    expect(lines).toEqual([]);
  });
});
