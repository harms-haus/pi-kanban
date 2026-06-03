/**
 * claim_tasks Tool
 *
 * Claims ready tasks from the kanban board, respecting maxClaims limits.
 */

import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Theme, ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { getBoard, getTasksByStatus, resolveTaskProfile } from "../state";
import { cloneBoard } from "../validation";
import { formatClaimTaskDetail, formatBoardText, renderToolResult } from "../formatting";
import { publishKanbanStatus } from "../status";

// ── Schema ──

const ClaimTasksParams = Type.Object({
  count: Type.Integer({ minimum: 1, description: "Number of tasks to claim" }),
});

// ── Tool Factory ──

export function createClaimTasksTool(): ToolDefinition<typeof ClaimTasksParams, KanbanDetails> {
  return {
    name: "claim_tasks",
    label: "Claim Tasks",
    description:
      "Claim up to count ready tasks from the kanban board, respecting maxClaims limits. Always returns all currently claimed (outstanding) tasks plus the newly claimed tasks.",
    parameters: ClaimTasksParams,
    promptSnippet: "Claim tasks from the kanban board",
    promptGuidelines: [
      "Use claim_tasks with a count to claim up to that many new ready tasks. All outstanding (already claimed) tasks are always included in the result.",
      "Outstanding (already claimed) tasks are always included in the output.",
      "The maximum number of concurrent claims is limited by the board's maxClaims setting.",
      "Use advance_tasks to move claimed tasks through their lifecycle phases.",
      "Use reject_tasks to reset a claimed task back to its first phase for re-execution while keeping it claimed.",
    ],

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(
      _toolCallId: string,
      params: { count: number },
      _signal: AbortSignal | undefined,
      _onUpdate: undefined,
      ctx: ExtensionContext,
    ) {
      const board = getBoard();
      if (!board) {
        throw new Error("No board exists. Use create_kanban first.");
      }

      const outstanding = getTasksByStatus("claimed");
      const ready = getTasksByStatus("ready");
      const maxClaims = board.maxClaims;
      const remaining = maxClaims - outstanding.length;

      const newlyClaimedCount = Math.min(params.count, ready.length, Math.max(0, remaining));
      const newlyClaimed: typeof outstanding = [];

      // Take first newlyClaimedCount ready tasks, set status and confirm profile
      newlyClaimed.push(...ready.slice(0, newlyClaimedCount));
      for (const task of newlyClaimed) {
        task.status = "claimed";
        task.profile = resolveTaskProfile(task, board.profileMap);
      }

      // Build content: outstanding + newly claimed
      const allClaimed = outstanding.concat(newlyClaimed);

      let text: string;

      if (allClaimed.length === 0) {
        text = "No tasks available. All tasks are blocked or done.";
      } else {
        const parts: string[] = [];

        // Header
        if (newlyClaimedCount > 0) {
          parts.push(`📌 Claimed ${newlyClaimedCount} task(s), ${outstanding.length} outstanding`);
        } else {
          parts.push(`📌 ${outstanding.length} outstanding claim(s)`);
        }

        // Task details, each separated by "---"
        for (const task of allClaimed) {
          parts.push(formatClaimTaskDetail(task));
          parts.push("---");
        }
        // Remove trailing "---"
        parts.pop();

        // Board summary
        parts.push("");
        parts.push(formatBoardText(board));

        text = parts.join("\n");
      }

      // Publish status to UI
      publishKanbanStatus(board, ctx);

      return {
        content: [{ type: "text" as const, text }],
        details: { action: "claim" as const, board: cloneBoard(board) },
      };
    },

    renderCall(params: { count: number }, theme: Theme) {
      return new Text(theme.fg("accent", `📌 claim_tasks (count: ${params.count})`));
    },

    renderResult: renderToolResult,
  };
}
