/**
 * write_kanban — delete mode
 *
 * Removes tasks from an existing kanban board.
 */

import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { clearBoard, recomputeStatuses } from "../state";
import { formatBoardText } from "../formatting";
import { deduplicateIds, finishMutation } from "../helpers";
import { requireBoard } from "../guard";

// ── Execute ──

/**
 * Core execute logic for write_kanban delete mode.
 */
export function executeDelete(
  params: { ids: string[] },
  ctx: ExtensionContext,
): AgentToolResult<KanbanDetails> {
  // 1. Board must exist
  const board = requireBoard();

  // 2. Deduplicate IDs
  const uniqueIds = deduplicateIds(params.ids);

  // 3. Atomic validation: all IDs must exist
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
  const errors: string[] = [];
  for (const id of uniqueIds) {
    if (!taskMap.has(id)) {
      errors.push(`task "${id}" not found`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Cannot delete: ${errors.join("; ")}`);
  }

  // 4. Remove matching tasks
  const deletedSet = new Set(uniqueIds);
  board.tasks = board.tasks.filter((t) => !deletedSet.has(t.id));

  // 5. Clean up blockedBy references
  for (const task of board.tasks) {
    task.blockedBy = task.blockedBy.filter((depId) => !deletedSet.has(depId));
  }

  // 6. Check if board is now empty
  if (board.tasks.length === 0) {
    clearBoard();
    return finishMutation(
      null,
      ctx,
      "write",
      `Deleted ${uniqueIds.length} task(s). Board cleared.`,
    );
  }

  // 7. Recompute statuses
  recomputeStatuses(board);

  // 8. Return result
  return finishMutation(
    board,
    ctx,
    "write",
    `Deleted ${uniqueIds.length} task(s)\n\n${formatBoardText(board)}`,
  );
}
