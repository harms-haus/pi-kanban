/**
 * reject_tasks tool
 *
 * Rejects one or more claimed tasks, resetting them to phase 0
 * while keeping them claimed.
 */

import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { Theme, ToolDefinition, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { MAX_IDS_IN_CALL, type KanbanBoard, type KanbanDetails } from "../types";
import { getBoard, getTaskById, resolveTaskProfile } from "../state";
import { cloneBoard } from "../validation";
import { formatTaskText, formatBoardText, renderToolResult } from "../formatting";
import { publishKanbanStatus } from "../status";

// ── Schema ──

const RejectTasksParams = Type.Object({
  ids: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: MAX_IDS_IN_CALL,
    description: "Task IDs to reject",
  }),
  reason: Type.Optional(Type.String({ description: "Reason for rejection" })),
});

type RejectTasksParamsType = typeof RejectTasksParams;

// ── Build Error Result ──

function rejectErrorResult(
  board: KanbanBoard | null,
  errorText: string,
): AgentToolResult<KanbanDetails> {
  return {
    content: [{ type: "text" as const, text: errorText }],
    details: {
      action: "reject" as const,
      board: board ? cloneBoard(board) : null,
      error: errorText,
    },
  };
}

// ── Tool Factory ──

export function createRejectTasksTool(): ToolDefinition<RejectTasksParamsType, KanbanDetails> {
  return {
    name: "reject_tasks",
    label: "Reject Tasks",
    description:
      "Reject one or more claimed tasks, resetting them to phase 0 while keeping them claimed. Tasks at the first phase can be rejected — this records the reason without changing the phase.",

    parameters: RejectTasksParams,

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      ctx,
    ): Promise<AgentToolResult<KanbanDetails>> {
      // 1. Board must exist
      const board = getBoard();
      if (!board) {
        return rejectErrorResult(null, "No board exists. Use create_kanban first.");
      }

      // 2. Deduplicate IDs
      const uniqueIds = [...new Set(params.ids)];

      // 3. Atomic validation — check ALL IDs before any changes
      const errors: string[] = [];

      for (const id of uniqueIds) {
        const task = getTaskById(id);
        if (!task) {
          errors.push(`task "${id}" not found`);
          continue;
        }
        if (task.status !== "claimed") {
          errors.push(`task "${id}" is not claimed (current status: ${task.status})`);
          continue;
        }
      }

      if (errors.length > 0) {
        return rejectErrorResult(board, `Cannot reject: ${errors.join("; ")}`);
      }

      // 4. Apply changes atomically (all validations passed)
      for (const id of uniqueIds) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const task = getTaskById(id)!;
        task.currentPhaseIndex = 0;
        task.status = "claimed";
        task.profile = resolveTaskProfile(task, board.profileMap);
        task.reason = params.reason ?? undefined;
      }

      // 5. Publish status to UI
      publishKanbanStatus(board, ctx);

      // 6. Build content: per-task rejection info + board summary
      const lines: string[] = [];
      for (const id of uniqueIds) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const task = getTaskById(id)!;
        const line = params.reason
          ? `↩ Rejected: ${formatTaskText(task)} (reason: ${params.reason})`
          : `↩ Rejected: ${formatTaskText(task)}`;
        lines.push(line);
      }
      lines.push("");
      lines.push(formatBoardText(board));

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          action: "reject" as const,
          board: cloneBoard(board),
        },
      };
    },

    renderCall(args: { ids: string[]; reason?: string }, theme: Theme): Text {
      const count = args.ids.length;
      const reasonPart = args.reason ? ` (${args.reason})` : "";
      return new Text(theme.fg("warning", `↩ reject_tasks (${count} tasks${reasonPart})`), 0, 0);
    },

    renderResult: renderToolResult,

    promptSnippet: "Reject claimed tasks, resetting to first phase while keeping claimed",
    promptGuidelines: [
      "Use reject_tasks when a task's work is not acceptable and needs to be restarted from the beginning.",
      "Tasks can be rejected at any phase, including the first phase (which records the reason without changing the phase index).",
      "Provide a reason for rejection to help the next worker understand what went wrong.",
      "After rejection, the task stays claimed but is reset to its first phase for re-execution.",
    ],
  };
}
