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
