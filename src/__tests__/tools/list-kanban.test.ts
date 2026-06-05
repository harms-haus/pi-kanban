import { describe, it, expect, beforeEach } from "vitest";
import { createListKanbanTool } from "../../tools/list-kanban";
import { resetState, setBoard, getBoard } from "../../state";
import { createMockContext, createMockTheme } from "../helpers/mock-api";
import { makeTask, makeBoard, noop, mockSignal } from "../helpers/test-helpers";

const tool = createListKanbanTool();
const mockCtx = createMockContext();

describe("list_kanban tool", () => {
  beforeEach(() => {
    resetState();
  });

  it('returns "no board" message when no board exists', async () => {
    const result = await tool.execute("call-1", {}, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("No board exists"),
    });
    expect(result.details.action).toBe("list");
    expect(result.details.board).toBeNull();
  });

  it("returns formatted board when it exists", async () => {
    const task1 = makeTask({ title: "Task A", status: "ready" });
    const task2 = makeTask({ title: "Task B", status: "claimed" });
    const board = makeBoard([task1, task2]);
    setBoard(board);

    const result = await tool.execute("call-1", {}, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Task A"),
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Task B"),
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Kanban Board"),
    });
    expect(result.details.action).toBe("list");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks).toHaveLength(2);
  });

  // ── renderCall ──

  it("renderCall returns themed text with tool name", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({}, theme, {} as any);
    expect(result).toBeDefined();
    const lines = result.render(80);
    expect(lines.join("\n")).toContain("list_kanban");
  });

  it("does not modify state", async () => {
    const task1 = makeTask({ title: "Task A", status: "ready" });
    const board = makeBoard([task1]);
    setBoard(board);
    const beforeBoard = structuredClone(board);

    await tool.execute("call-1", {}, mockSignal, noop, mockCtx);

    const afterBoard = getBoard()!;
    expect(afterBoard).not.toBeNull();
    expect(afterBoard.tasks).toHaveLength(beforeBoard.tasks.length);
    expect(afterBoard.tasks[0]!.status).toBe("ready");
    expect(afterBoard.tasks[0]!.title).toBe("Task A");
  });
});
