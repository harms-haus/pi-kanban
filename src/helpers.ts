/**
 * Kanban Helpers
 *
 * Shared utility functions used across kanban tool implementations.
 */

import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails } from "./types";
import { publishKanbanStatus, publishEmptyStatus } from "./status";
import { cloneBoard } from "./validation";

// ── Deduplication ─────────────────────────────────────────────────────

/**
 * Removes duplicate string IDs, preserving first occurrence order.
 */
export function deduplicateIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Removes duplicate items by a key function, preserving first occurrence order.
 */
export function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...new Map(items.map((i) => [keyFn(i), i])).values()];
}

// ── Mutation Finalization ─────────────────────────────────────────────

/**
 * Finalizes a board mutation by publishing status and returning a tool result.
 */
export function finishMutation(
  board: KanbanBoard | null,
  ctx: ExtensionContext,
  action: KanbanDetails["action"],
  contentText: string,
): AgentToolResult<KanbanDetails> {
  if (board) {
    publishKanbanStatus(board, ctx);
  } else {
    publishEmptyStatus(ctx);
  }
  return {
    content: [{ type: "text" as const, text: contentText }],
    details: { action, board: board ? cloneBoard(board) : null },
  };
}
