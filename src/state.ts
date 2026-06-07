/**
 * Kanban State Management
 *
 * Mutable in-memory state for the kanban board.
 */

import type { KanbanBoard, Task, TaskStatus } from "./types";

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

/** Clears the board, setting it to null. Used when all tasks are deleted. */
export function clearBoard(): void {
  board = null;
}

/** Resets all mutable state. Called on session shutdown and in tests. */
export function resetState(): void {
  clearBoard();
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
