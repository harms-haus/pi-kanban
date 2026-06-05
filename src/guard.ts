/**
 * Board Guards
 *
 * Convenience guards that assert board existence (or absence) and throw
 * descriptive errors when violated.
 */

import type { KanbanBoard } from "./types";
import { getBoard } from "./state";

/** Throws if no board exists. Returns the board otherwise. */
export function requireBoard(): KanbanBoard {
  const b = getBoard();
  if (b === null) {
    throw new Error("No board exists. Use write_kanban with mode 'replace' to create one.");
  }
  return b;
}

/** Throws if a board already exists. */
export function requireNoBoard(): void {
  if (getBoard() !== null) {
    throw new Error(
      "Board already exists. Use advance_tasks/reject_tasks to modify tasks, or write_kanban with append/edit/delete modes.",
    );
  }
}
