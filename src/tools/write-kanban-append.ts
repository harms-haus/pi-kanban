/**
 * write_kanban — append mode
 *
 * Adds tasks to an existing kanban board.
 */

import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { MAX_TASKS } from "../types";
import { recomputeStatuses } from "../state";
import { resolveBlockedByTitles } from "../resolve-deps";
import { resolveTaskProfile } from "../resolve-profile";
import { detectCycles } from "../validation";
import { formatBoardText } from "../formatting";
import { finishMutation } from "../helpers";
import { requireBoard } from "../guard";
import { buildTasks } from "./write-kanban-replace.js";
import type { TaskInput } from "./write-kanban-replace.js";

// ── Execute ──

/**
 * Core execute logic for write_kanban append mode.
 */
export function executeAppend(
  params: {
    tasks: TaskInput[];
    profileMap?: Record<string, string>;
  },
  ctx: ExtensionContext,
): AgentToolResult<KanbanDetails> {
  // 1. Board must exist
  const board = requireBoard();

  // 2. Check MAX_TASKS limit
  if (board.tasks.length + params.tasks.length > MAX_TASKS) {
    throw new Error(
      `Cannot append ${params.tasks.length} task(s): board would exceed ${MAX_TASKS} task limit (currently ${board.tasks.length}).`,
    );
  }

  // 3. Build new tasks starting from board.nextId
  const newTasks = buildTasks(params.tasks, board.nextId);

  // 4. Combine existing + new for validation
  const allTasks = [...board.tasks, ...newTasks];

  // 5. Compute merged profileMap without mutating board yet
  const mergedProfileMap = params.profileMap
    ? { ...board.profileMap, ...params.profileMap }
    : board.profileMap;

  // 6. Resolve blockedBy on combined array (before cycle detection)
  const resolveResult = resolveBlockedByTitles(allTasks);
  if (!resolveResult.success) {
    throw new Error(resolveResult.error);
  }

  // 7. Cycle detection on combined array (after title resolution)
  const cycleError = detectCycles(allTasks);
  if (cycleError) {
    throw new Error(cycleError);
  }

  // 8. Commit profileMap mutation now that validation has passed
  if (params.profileMap) {
    board.profileMap = mergedProfileMap;
  }

  // 9. Add new tasks and update nextId
  board.tasks.push(...newTasks);
  board.nextId += newTasks.length;

  // 10. Recompute statuses
  recomputeStatuses(board);

  // 11. Resolve profiles for new tasks
  for (const task of newTasks) {
    task.profile = resolveTaskProfile(task, board.profileMap);
  }

  // 12. Return result
  return finishMutation(
    board,
    ctx,
    "write",
    `Appended ${newTasks.length} task(s) to board\n\n${formatBoardText(board)}`,
  );
}
