/**
 * Kanban State Management
 *
 * Mutable in-memory state for the kanban board with persistence
 * reconstruction from session history.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, Task, TaskStatus } from "./types";
import { TOOL_NAMES } from "./types";
import { isValidTask, cloneBoard } from "./validation";
import { resolveProfile } from "./settings";

// ── Mutable State ──

let board: KanbanBoard | null = null;

// ── State Accessors ──

/** Returns the current board, or null if none has been created. */
export function getBoard(): KanbanBoard | null {
  return board;
}

/** Replaces the board with a new one. */
export function setBoard(newBoard: KanbanBoard): void {
  board = newBoard;
}

/** Resets all mutable state. For testing only. */
export function resetState(): void {
  board = null;
}

// ── Task Lookup Helpers ──

/** Finds a task by ID in the current board. Returns undefined if not found or no board. */
export function getTaskById(id: string): Task | undefined {
  return board?.tasks.find((t) => t.id === id);
}

/** Returns all tasks with the given status. Returns empty array if no board. */
export function getTasksByStatus(status: TaskStatus): Task[] {
  return board?.tasks.filter((t) => t.status === status) ?? [];
}

// ── Resolve Blocked-By Titles ──

/**
 * For each task's blockedBy entries, resolve title references to task IDs.
 *
 * Resolves titles across the entire passed array (for append mode, the caller
 * passes existing + new tasks combined). If a blockedBy entry is a valid kb-N ID
 * that matches an existing task ID, it is kept as-is. Otherwise it is treated as
 * a title and replaced with the matching task's ID.
 * Returns an error if any reference cannot be resolved.
 */
export function resolveBlockedByTitles(
  tasks: Task[],
): { success: true } | { success: false; error: string } {
  const idSet = new Set(tasks.map((t) => t.id));
  // kb-N ID pattern
  const KB_ID_RE = /^kb-\d+$/;

  for (const task of tasks) {
    const resolved: string[] = [];

    for (const ref of task.blockedBy) {
      // If it matches the kb-N ID format and exists as a task ID, keep it
      if (KB_ID_RE.test(ref) && idSet.has(ref)) {
        resolved.push(ref);
        continue;
      }

      // Otherwise treat as a title — find the matching task
      const match = tasks.find((t) => t.title === ref);
      if (match) {
        resolved.push(match.id);
      } else {
        return {
          success: false,
          error: `cannot resolve blockedBy reference "${ref}" for task "${task.id}"`,
        };
      }
    }

    // Replace the blockedBy array with resolved IDs
    (task as { blockedBy: string[] }).blockedBy = resolved;
  }

  return { success: true };
}

// ── Compute Initial Statuses ──

/**
 * Sets initial statuses for all tasks on the board.
 *
 * - Tasks with no blockedBy entries → "ready"
 * - Tasks with blockedBy entries → "blocked"
 */
export function computeInitialStatuses(board: KanbanBoard): void {
  for (const task of board.tasks) {
    task.status = task.blockedBy.length === 0 ? "ready" : "blocked";
  }
}

// ── Unblock Dependents ──

/**
 * After a task reaches "done", scan all tasks and unblock any whose
 * dependencies are all satisfied (all blockedBy tasks have status "done").
 */
export function unblockDependents(_taskId: string): void {
  if (!board) return;

  // Build a quick lookup map
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));

  // Only re-evaluate tasks that are currently blocked
  for (const task of board.tasks) {
    if (task.status !== "blocked") continue;
    if (task.blockedBy.length === 0) {
      task.status = "ready";
      continue;
    }

    const allDone = task.blockedBy.every((depId) => {
      const dep = taskMap.get(depId);
      return dep?.status === "done";
    });

    if (allDone) {
      task.status = "ready";
    }
  }
}

// ── Recompute Statuses ──

/**
 * Recomputes statuses for all tasks with status "blocked" or "ready".
 *
 * Does NOT touch tasks with status "claimed" or "done". Uses a taskMap
 * for O(1) dependency lookups.
 *
 * Logic for each blocked/ready task:
 * - If blockedBy.length === 0 → "ready"
 * - Else if ALL blockedBy task IDs have status "done" → "ready"
 * - Else → "blocked"
 */
export function recomputeStatuses(board: KanbanBoard): void {
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));

  for (const task of board.tasks) {
    if (task.status !== "blocked" && task.status !== "ready") continue;

    if (task.blockedBy.length === 0) {
      task.status = "ready";
      continue;
    }

    const allDone = task.blockedBy.every((depId) => {
      const dep = taskMap.get(depId);
      return dep?.status === "done";
    });

    task.status = allDone ? "ready" : "blocked";
  }
}

// ── Resolve Task Profile ──

/**
 * Resolves the subagent profile for the task's current phase.
 *
 * Uses resolveProfile from settings. Returns empty string for done tasks
 * (currentPhaseIndex === -1).
 */
export function resolveTaskProfile(task: Task, profileMap: Record<string, string>): string {
  if (task.currentPhaseIndex === -1 || task.currentPhaseIndex >= task.phases.length) return "";
  const phase = task.phases[task.currentPhaseIndex];
  if (!phase) return "";
  return resolveProfile(phase, profileMap);
}

// ── State Reconstruction ──

/**
 * Type guard: checks that `d` is an object with a `board` field
 * that is a non-null object with a `tasks` array.
 */
function hasBoardField(d: unknown): d is { board: Record<string, unknown> } {
  if (typeof d !== "object" || d === null) return false;
  const obj = d as Record<string, unknown>;
  if (!("board" in obj)) return false;
  const b = obj.board;
  if (typeof b !== "object" || b === null) return false;
  const boardObj = b as Record<string, unknown>;
  return Array.isArray(boardObj.tasks);
}

/**
 * Reconstructs kanban board state from session history.
 *
 * Scans the session branch in reverse to find the last tool result
 * from this extension. Validates tasks with isValidTask and returns
 * a deep clone of the first valid board found, or null if none exist.
 */
export function reconstructState(ctx: ExtensionContext): KanbanBoard | null {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!entry) continue;
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    if (!TOOL_NAMES.has(msg.toolName)) continue;
    if (!hasBoardField(msg.details)) continue;

    const rawBoard = msg.details.board;
    const rawTasks = rawBoard.tasks;

    if (!Array.isArray(rawTasks) || rawTasks.length === 0) continue;

    // Only keep valid tasks
    const validTasks = rawTasks.filter((t: unknown) => isValidTask(t));

    if (validTasks.length === 0) continue;

    // Compute nextId: use raw value if present, otherwise derive from task IDs
    const nextId: number =
      typeof rawBoard.nextId === "number"
        ? rawBoard.nextId
        : Math.max(
            0,
            ...validTasks.map((t: Task) => {
              const n = parseInt(t.id.slice(3), 10);
              return Number.isNaN(n) ? 0 : n;
            }),
          ) + 1;

    // Reconstruct a proper KanbanBoard from the raw data
    const reconstructed: KanbanBoard = {
      tasks: validTasks,
      profileMap:
        typeof rawBoard.profileMap === "object" && rawBoard.profileMap !== null
          ? (rawBoard.profileMap as Record<string, string>)
          : {},
      maxClaims: typeof rawBoard.maxClaims === "number" ? rawBoard.maxClaims : 4,
      createdAt: typeof rawBoard.createdAt === "number" ? rawBoard.createdAt : Date.now(),
      nextId,
    };

    return cloneBoard(reconstructed);
  }

  return null;
}
