import { describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { createClaimTasksTool } from "../../tools/claim-tasks";
import { resetState, getBoard } from "../../state";
import { createMockContext, createMockTheme } from "../helpers/mock-api";
import { makeTask, setupBoard, noop, mockSignal } from "../helpers/test-helpers";

const tool = createClaimTasksTool();
const mockCtx = createMockContext();

describe("claim_tasks tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("claims up to N ready tasks", async () => {
    const t1 = makeTask({ title: "Task A", status: "ready" });
    const t2 = makeTask({ title: "Task B", status: "ready" });
    const t3 = makeTask({ title: "Task C", status: "ready" });
    setupBoard([t1, t2, t3]);

    const result = await tool.execute("call-1", { count: 2 }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Claimed 2 task(s)"),
    });

    const board = getBoard()!;
    const claimed = board.tasks.filter((t) => t.status === "claimed");
    expect(claimed).toHaveLength(2);
  });

  it("always includes outstanding tasks", async () => {
    const t1 = makeTask({ title: "Outstanding", status: "claimed" });
    const t2 = makeTask({ title: "Ready Task", status: "ready" });
    setupBoard([t1, t2]);

    const result = await tool.execute("call-1", { count: 2 }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Outstanding"),
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Ready Task"),
    });
  });

  it("respects maxClaims limit", async () => {
    const t1 = makeTask({ title: "Already Claimed", status: "claimed" });
    const t2 = makeTask({ title: "Ready A", status: "ready" });
    const t3 = makeTask({ title: "Ready B", status: "ready" });
    // maxClaims = 2, 1 already claimed → can only claim 1 more
    setupBoard([t1, t2, t3], { maxClaims: 2 });

    const result = await tool.execute("call-1", { count: 5 }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Claimed 1 task(s)"),
    });

    const board = getBoard()!;
    const claimed = board.tasks.filter((t) => t.status === "claimed");
    expect(claimed).toHaveLength(2); // 1 existing + 1 new
  });

  it("claims in creation order", async () => {
    const t1 = makeTask({ title: "First", status: "ready" });
    const t2 = makeTask({ title: "Second", status: "ready" });
    const t3 = makeTask({ title: "Third", status: "ready" });
    setupBoard([t1, t2, t3]);

    await tool.execute("call-1", { count: 2 }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");
    expect(board.tasks[1]!.status).toBe("claimed");
    expect(board.tasks[2]!.status).toBe("ready");
  });

  it("sets status to claimed", async () => {
    const t1 = makeTask({ title: "Task A", status: "ready" });
    setupBoard([t1]);

    await tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx);

    const board = getBoard()!;
    expect(board.tasks[0]!.status).toBe("claimed");
  });

  it("returns full task details", async () => {
    const t1 = makeTask({
      id: "kb-detail",
      title: "Detailed Task",
      description: "A very detailed description",
      files: ["src/foo.ts", "src/bar.ts"],
      phases: ["implement", "review"],
      status: "ready",
    });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx);

    const firstContent = result.content[0]!;
    const text = firstContent.type === "text" ? firstContent.text : "";
    expect(text).toContain("Detailed Task");
    expect(text).toContain("A very detailed description");
    expect(text).toContain("src/foo.ts");
    expect(text).toContain("src/bar.ts");
  });

  it("returns informative message when all blocked and no outstanding", async () => {
    const t1 = makeTask({ title: "Blocked A", status: "blocked", blockedBy: ["fake-id"] });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("No tasks available"),
    });
  });

  it("throws when no board exists", async () => {
    await expect(tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx)).rejects.toThrow(
      "No board exists",
    );
  });

  it("claims new tasks even when outstanding count >= requested count", async () => {
    const t1 = makeTask({ title: "Claimed 1", status: "claimed" });
    const t2 = makeTask({ title: "Claimed 2", status: "claimed" });
    const t3 = makeTask({ title: "Claimed 3", status: "claimed" });
    const t4 = makeTask({ title: "Ready A", status: "ready" });
    const t5 = makeTask({ title: "Ready B", status: "ready" });
    setupBoard([t1, t2, t3, t4, t5], { maxClaims: 5 });

    const result = await tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx);

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Claimed 1 task(s)"),
    });

    const board = getBoard()!;
    const claimed = board.tasks.filter((t) => t.status === "claimed");
    expect(claimed).toHaveLength(4);
  });

  it("returns all claimed tasks even when requesting fewer", async () => {
    const claimedTasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ title: `Claimed ${i + 1}`, status: "claimed" }),
    );
    const t6 = makeTask({ title: "Ready A", status: "ready" });
    const t7 = makeTask({ title: "Ready B", status: "ready" });
    setupBoard([...claimedTasks, t6, t7], { maxClaims: 10 });

    const result = await tool.execute("call-1", { count: 2 }, mockSignal, noop, mockCtx);

    const text = result.content[0]!.type === "text" ? result.content[0]!.text : "";
    for (let i = 1; i <= 5; i++) {
      expect(text).toContain(`Claimed ${i}`);
    }
    expect(text).toContain("Ready A");
    expect(text).toContain("Ready B");

    const board = getBoard()!;
    const claimed = board.tasks.filter((t) => t.status === "claimed");
    expect(claimed).toHaveLength(7);
  });

  it("publishes kanban status to UI on success", async () => {
    const ctxWithUI = createMockContext({ hasUI: true });
    const t1 = makeTask({ title: "Ready A", status: "ready" });
    const t2 = makeTask({ title: "Ready B", status: "ready" });
    setupBoard([t1, t2]);

    await tool.execute("call-1", { count: 1 }, mockSignal, noop, ctxWithUI);

    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledOnce();
    expect(ctxWithUI.ui.setStatus).toHaveBeenCalledWith("kanban", expect.any(String));

    const payload = JSON.parse((ctxWithUI.ui.setStatus as Mock).mock.calls[0]![1] as string);
    expect(payload.total).toBe(2);
    expect(payload.claimed).toBe(1);
    expect(payload.ready).toBe(1);
  });

  // ── renderCall ──

  it("renderCall returns themed text with tool name and count", () => {
    const theme = createMockTheme();
    const result = tool.renderCall!({ count: 3 }, theme, {} as any);
    expect(result).toBeDefined();
    const lines = result.render(80);
    expect(lines.join("\n")).toContain("claim_tasks");
    expect(lines.join("\n")).toContain("3");
  });

  it("details contain board snapshot", async () => {
    const t1 = makeTask({ title: "Task A", status: "ready" });
    setupBoard([t1]);

    const result = await tool.execute("call-1", { count: 1 }, mockSignal, noop, mockCtx);

    expect(result.details.action).toBe("claim");
    expect(result.details.board).not.toBeNull();
    expect(result.details.board!.tasks).toHaveLength(1);
  });
});
