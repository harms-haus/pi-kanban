/**
 * State Reconstruction
 *
 * Reconstructs kanban board state from session history.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, Task } from "./types";
import { TOOL_NAMES } from "./types";
import { isValidTask, cloneBoard } from "./validation";

// ── Helpers ──

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

// ── State Reconstruction ──

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
