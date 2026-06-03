/**
 * Kanban Extension — Kanban-style task board for managing work across parallel subagents
 *
 * Registers 5 tools: create_kanban, list_kanban, claim_tasks, advance_tasks, reject_tasks
 *
 * Features:
 * - Full board state in LLM content after every tool call
 * - Full board rendered in history with themed status/phase icons
 * - State persisted in tool result details for proper branching support
 * - Hidden context injection via before_agent_start listing active tasks
 * - State reconstruction from session history on session_start / session_tree
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getBoard, setBoard, resetState, reconstructState } from "./state";
import { formatBoardText } from "./formatting";
import { createKanbanTool } from "./tools/create-kanban";
import { createListKanbanTool } from "./tools/list-kanban";
import { createClaimTasksTool } from "./tools/claim-tasks";
import { createAdvanceTasksTool } from "./tools/advance-tasks";
import { createRejectTasksTool } from "./tools/reject-tasks";

export default function (pi: ExtensionAPI): void {
  // ── Register Tools ──
  pi.registerTool(createKanbanTool());
  pi.registerTool(createListKanbanTool());
  pi.registerTool(createClaimTasksTool());
  pi.registerTool(createAdvanceTasksTool());
  pi.registerTool(createRejectTasksTool());

  // ── Event Handlers ──

  pi.on("session_start", (_event, ctx) => {
    const reconstructed = reconstructState(ctx);
    if (reconstructed !== null) {
      setBoard(reconstructed);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    const reconstructed = reconstructState(ctx);
    if (reconstructed !== null) {
      setBoard(reconstructed);
    }
  });

  pi.on("session_shutdown", (_event, _ctx) => {
    resetState();
  });

  pi.on("before_agent_start", () => {
    const board = getBoard();
    if (!board) return;

    const incomplete = board.tasks.filter((t) => t.status !== "done");
    if (incomplete.length === 0) return;

    return {
      message: {
        customType: "kanban-context",
        content: [
          {
            type: "text" as const,
            text: `[KANBAN ACTIVE]\n\n${formatBoardText(board)}\n\n${incomplete.length} task(s) remaining. Use claim_tasks to pick up work or list_kanban to view the board.`,
          },
        ],
        display: false,
      },
    };
  });

  // ── Message Renderer ──

  pi.registerMessageRenderer("kanban-context", (message, _opts, theme) => {
    const firstLine =
      typeof message.content === "string"
        ? (message.content.split("\n")[0] ?? "")
        : message.content[0]?.type === "text"
          ? (message.content[0].text.split("\n")[0] ?? "")
          : "";
    return new Text(theme.fg("dim", `📋 ${firstLine}`));
  });
}
