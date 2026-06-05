/**
 * write_kanban — edit mode
 *
 * Modifies existing tasks on a kanban board.
 */

import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails, Task } from "../types";
import { recomputeStatuses } from "../state";
import { resolveBlockedByTitles } from "../resolve-deps";
import { resolveTaskProfile } from "../resolve-profile";
import { validatePhases, detectCycles } from "../validation";
import { formatBoardText } from "../formatting";
import { deduplicateBy, finishMutation } from "../helpers";
import { requireBoard } from "../guard";

// ── Types ──

/** Shape of the 'set' object in an edit entry */
export interface EditSet {
  title?: string;
  description?: string;
  files?: string[];
  phases?: string[];
  blockedBy?: string[];
}

/** Edit entry type for internal use */
export type EditEntry = { id: string; set: EditSet };

// ── Helpers ──

/**
 * Validate edit entries atomically, collecting all errors.
 */
function validateEditEntries(
  board: KanbanBoard,
  uniqueEdits: EditEntry[],
): { taskMap: Map<string, Task>; errors: string[] } {
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
  const errors: string[] = [];

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) {
      errors.push(`task "${edit.id}" not found`);
      continue;
    }

    const setFields = Object.keys(edit.set).filter(
      (k) => (edit.set as Record<string, unknown>)[k] !== undefined,
    );
    if (setFields.length === 0) {
      errors.push(`edit for task "${edit.id}" has empty set`);
      continue;
    }

    if (edit.set.phases !== undefined) {
      const phaseResult = validatePhases(edit.set.phases);
      if (!phaseResult.valid) {
        errors.push(`invalid phases for task "${edit.id}": ${phaseResult.error}`);
      }
    }
  }

  return { taskMap, errors };
}

/**
 * Apply a single edit to a task, returning change flags.
 */
function applyEditToTask(
  task: Task,
  edit: EditEntry,
): { blockedByChanged: boolean; phasesChanged: boolean } {
  let blockedByChanged = false;
  let phasesChanged = false;

  if (edit.set.title !== undefined) task.title = edit.set.title;
  if (edit.set.description !== undefined) task.description = edit.set.description;
  if (edit.set.files !== undefined) task.files = edit.set.files;

  if (edit.set.phases !== undefined) {
    const phaseResult = validatePhases(edit.set.phases);
    // Phases already validated in validateEditEntries — safe to narrow
    if (phaseResult.valid) {
      task.phases = phaseResult.phases;
    }
    phasesChanged = true;

    if (task.currentPhaseIndex >= task.phases.length) {
      task.currentPhaseIndex = task.phases.length - 1;
    }
  }

  if (edit.set.blockedBy !== undefined) {
    task.blockedBy = edit.set.blockedBy;
    blockedByChanged = true;
  }

  return { blockedByChanged, phasesChanged };
}

/**
 * Rollback mutated tasks to their pre-edit snapshots.
 */
function rollbackEdits(taskMap: Map<string, Task>, snapshots: Map<string, Task>): void {
  for (const [id, snap] of snapshots) {
    const task = taskMap.get(id);
    if (task) Object.assign(task, snap);
  }
}

// ── Execute ──

/**
 * Core execute logic for write_kanban edit mode.
 */
export function executeEdit(
  params: { edits: EditEntry[] },
  ctx: ExtensionContext,
): AgentToolResult<KanbanDetails> {
  const board = requireBoard();

  const uniqueEdits = deduplicateBy(params.edits, (e) => e.id);

  const { taskMap, errors } = validateEditEntries(board, uniqueEdits);
  if (errors.length > 0) {
    throw new Error(`Cannot edit: ${errors.join("; ")}`);
  }

  // Snapshot original values for rollback on validation failure
  const snapshots = new Map<string, Task>();

  let blockedByChanged = false;
  let phasesChanged = false;

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;
    snapshots.set(edit.id, structuredClone(task));
    const result = applyEditToTask(task, edit);
    blockedByChanged = blockedByChanged || result.blockedByChanged;
    phasesChanged = phasesChanged || result.phasesChanged;
  }

  // Validate blocked-by references and cycle-free graph (rollback if invalid)
  let validationError: string | null = null;
  if (blockedByChanged) {
    const resolveResult = resolveBlockedByTitles(board.tasks);
    if (!resolveResult.success) {
      validationError = resolveResult.error;
    } else {
      validationError = detectCycles(board.tasks);
    }
  }

  if (validationError) {
    rollbackEdits(taskMap, snapshots);
    throw new Error(validationError);
  }

  if (blockedByChanged || phasesChanged) {
    recomputeStatuses(board);
  }

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;
    task.profile = resolveTaskProfile(task, board.profileMap);
  }

  return finishMutation(
    board,
    ctx,
    "write",
    `Edited ${uniqueEdits.length} task(s)\n\n${formatBoardText(board)}`,
  );
}
