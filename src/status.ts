/**
 * Kanban Status Publishing
 *
 * Publishes board status to the UI for real-time display.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard } from "./types";
import { formatPhaseLabel } from "./formatting";

// ── Types ──

export interface KanbanStatusPayload {
  total: number;
  claimed: number;
  ready: number;
  blocked: number;
  done: number;
  claimedTasks: Array<{ id: string; title: string; phase: string }>;
}

// ── Public API ──

/**
 * Publishes the current kanban board status to the UI.
 *
 * Guards on `ctx.hasUI` — returns early if no UI is available.
 * Calls `ctx.ui.setStatus("kanban", ...)` with a JSON payload containing
 * task counts and details of claimed tasks.
 */
export function publishKanbanStatus(board: KanbanBoard, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  const tasks = board.tasks;

  const total = tasks.length;
  let claimed = 0;
  let ready = 0;
  let blocked = 0;
  let done = 0;
  const claimedTasks: KanbanStatusPayload["claimedTasks"] = [];

  for (const task of tasks) {
    switch (task.status) {
      case "claimed":
        claimed++;
        claimedTasks.push({
          id: task.id,
          title: task.title,
          phase: formatPhaseLabel(task),
        });
        break;
      case "ready":
        ready++;
        break;
      case "blocked":
        blocked++;
        break;
      case "done":
        done++;
        break;
    }
  }

  const payload: KanbanStatusPayload = {
    total,
    claimed,
    ready,
    blocked,
    done,
    claimedTasks,
  };

  ctx.ui.setStatus("kanban", JSON.stringify(payload));
}
