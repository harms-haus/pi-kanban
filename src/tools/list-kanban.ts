/**
 * list_kanban Tool
 *
 * Lists all tasks on the current kanban board with their statuses and phases.
 */

import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { getBoard } from "../state";
import { cloneBoard } from "../validation";
import { formatBoardText, renderToolResult } from "../formatting";

// ── Schema ──

const ListKanbanParams = Type.Object({});

// ── Tool Factory ──

export function createListKanbanTool(): ToolDefinition<typeof ListKanbanParams, KanbanDetails> {
  return {
    name: "list_kanban",
    label: "List Kanban Board",
    description:
      "List all tasks on the current kanban board with their statuses, phases, and dependency information.",
    parameters: ListKanbanParams,
    promptSnippet: "List all tasks on the current kanban board",
    promptGuidelines: [
      "Use list_kanban to view the current board state and task statuses before deciding next steps.",
      "The board shows tasks grouped by status: claimed, ready, blocked, done.",
    ],

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(
      _toolCallId,
      _params,
      _signal,
      _onUpdate: AgentToolUpdateCallback<KanbanDetails> | undefined,
      _ctx,
    ) {
      const board = getBoard();

      if (board === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No board exists. Use write_kanban to create one.",
            },
          ],
          details: { action: "list" as const, board: null },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatBoardText(board),
          },
        ],
        details: { action: "list" as const, board: cloneBoard(board) },
      };
    },

    renderCall(_params, theme) {
      return new Text(theme.fg("text", "📋 list_kanban"), 0, 0);
    },

    renderResult: renderToolResult,
  };
}
