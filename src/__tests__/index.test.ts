/**
 * Integration Tests for the Kanban Extension Entry Point
 *
 * Tests that the extension factory:
 * - Registers exactly 5 tools with correct names
 * - Registers event handlers for session lifecycle events
 * - Registers a message renderer for "kanban-context"
 * - Event handlers behave correctly (state reconstruction, reset, context injection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module Mocks ──

vi.mock("../state", () => ({
  getBoard: vi.fn(),
  setBoard: vi.fn(),
  resetState: vi.fn(),
  reconstructState: vi.fn(),
}));

// Import after mocks are set up
import extensionFactory from "../index";
import { getBoard, setBoard, resetState, reconstructState } from "../state";
import { createMockAPI, createMockContext } from "./helpers/mock-api";
import { makeTask, makeBoard } from "./helpers/test-data";

// ── Helpers ──

/** Extract a registered event handler by event name from capturedHandlers. */
function getHandler(
  capturedHandlers: Map<string, (event: unknown, ctx: unknown) => unknown>,
  eventName: string,
): (event: unknown, ctx: unknown) => unknown {
  const handler = capturedHandlers.get(eventName);
  if (!handler) throw new Error(`No handler registered for "${eventName}"`);
  return handler;
}

// ── Tests ──

describe("default export (extension factory)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Tool Registration ──

  it("registers exactly 5 tools", () => {
    const { api, capturedTools } = createMockAPI();
    extensionFactory(api);
    expect(capturedTools).toHaveLength(5);
  });

  it("registers tools with correct names", () => {
    const { api, capturedTools } = createMockAPI();
    extensionFactory(api);
    const names = capturedTools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_kanban",
        "list_kanban",
        "claim_tasks",
        "advance_tasks",
        "reject_tasks",
      ]),
    );
  });

  // ── Event Handler Registration ──

  it("registers event handlers for session_start, session_tree, session_shutdown, before_agent_start", () => {
    const { api, capturedHandlers } = createMockAPI();
    extensionFactory(api);
    expect(capturedHandlers.has("session_start")).toBe(true);
    expect(capturedHandlers.has("session_tree")).toBe(true);
    expect(capturedHandlers.has("session_shutdown")).toBe(true);
    expect(capturedHandlers.has("before_agent_start")).toBe(true);
  });

  // ── Message Renderer Registration ──

  it("registers a message renderer for 'kanban-context'", () => {
    const { api, capturedRenderers } = createMockAPI();
    extensionFactory(api);
    expect(capturedRenderers.has("kanban-context")).toBe(true);
  });

  // ── session_start Handler ──

  describe("session_start handler", () => {
    it("with empty branch → does not call setBoard (board remains null)", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "session_start");

      vi.mocked(reconstructState).mockReturnValue(null);
      const ctx = createMockContext();

      handler({}, ctx);

      expect(reconstructState).toHaveBeenCalledWith(ctx);
      expect(setBoard).not.toHaveBeenCalled();
    });

    it("with valid kanban entry → board is reconstructed and set", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "session_start");

      const board = makeBoard([makeTask()]);
      vi.mocked(reconstructState).mockReturnValue(board);
      const ctx = createMockContext();

      handler({}, ctx);

      expect(reconstructState).toHaveBeenCalledWith(ctx);
      expect(setBoard).toHaveBeenCalledWith(board);
    });
  });

  // ── session_tree Handler ──

  describe("session_tree handler", () => {
    it("replaces board state from new branch", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "session_tree");

      const board = makeBoard([makeTask({ id: "new-board" })]);
      vi.mocked(reconstructState).mockReturnValue(board);
      const ctx = createMockContext();

      handler({}, ctx);

      expect(reconstructState).toHaveBeenCalledWith(ctx);
      expect(setBoard).toHaveBeenCalledWith(board);
    });

    it("does not call setBoard if no kanban entries in branch", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "session_tree");

      vi.mocked(reconstructState).mockReturnValue(null);
      const ctx = createMockContext();

      handler({}, ctx);

      expect(reconstructState).toHaveBeenCalledWith(ctx);
      expect(setBoard).not.toHaveBeenCalled();
    });
  });

  // ── session_shutdown Handler ──

  describe("session_shutdown handler", () => {
    it("calls resetState", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "session_shutdown");

      handler({}, createMockContext());

      expect(resetState).toHaveBeenCalled();
    });
  });

  // ── before_agent_start Handler ──

  describe("before_agent_start handler", () => {
    it("returns undefined when no board exists", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "before_agent_start");

      vi.mocked(getBoard).mockReturnValue(null);

      const result = handler(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it("returns undefined when all tasks are done", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "before_agent_start");

      const board = makeBoard([
        makeTask({ id: "t1", status: "done", currentPhaseIndex: -1 }),
        makeTask({ id: "t2", status: "done", currentPhaseIndex: -1 }),
      ]);
      vi.mocked(getBoard).mockReturnValue(board);

      const result = handler(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it("returns undefined when board has no tasks", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "before_agent_start");

      const board = makeBoard([]);
      vi.mocked(getBoard).mockReturnValue(board);

      const result = handler(undefined, undefined);
      expect(result).toBeUndefined();
    });

    it("returns a hidden context message when board has incomplete tasks", () => {
      const { api, capturedHandlers } = createMockAPI();
      extensionFactory(api);
      const handler = getHandler(capturedHandlers, "before_agent_start");

      const board = makeBoard([
        makeTask({ id: "t1", status: "ready" }),
        makeTask({ id: "t2", status: "done", currentPhaseIndex: -1 }),
      ]);
      vi.mocked(getBoard).mockReturnValue(board);

      const result = handler(undefined, undefined) as {
        message: {
          customType: string;
          content: Array<{ type: string; text: string }>;
          display: boolean;
        };
      };
      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
      expect(result.message.customType).toBe("kanban-context");
      expect(result.message.display).toBe(false);
      expect(Array.isArray(result.message.content)).toBe(true);
      expect(result.message.content[0]!.type).toBe("text");
      expect(result.message.content[0]!.text).toContain("[KANBAN ACTIVE]");
    });
  });
});
