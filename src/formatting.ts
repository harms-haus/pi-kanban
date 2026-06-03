/**
 * Kanban Formatting
 *
 * Plain-text formatting for LLM consumption and themed formatting
 * for TUI rendering.
 */

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails, Task, TaskStatus } from "./types";
import { STATUS_ICONS, PHASE_ICONS } from "./types";

// ── Plain-Text Formatting (for LLM content) ──

/**
 * Returns the current phase label for a task.
 * Returns "done" for completed tasks (currentPhaseIndex === -1).
 */
export function formatPhaseLabel(task: Task): string {
  if (task.currentPhaseIndex === -1 || task.currentPhaseIndex >= task.phases.length) return "done";
  return task.phases[task.currentPhaseIndex] ?? "done";
}

/**
 * Formats a single task as plain text.
 *
 * Format: `{status_icon} {phase_icon} [{id}] {title} → {deps}` (deps optional)
 */
export function formatTaskText(task: Task): string {
  const icon = STATUS_ICONS[task.status];
  const phaseLabel = formatPhaseLabel(task);
  const phaseIcon = PHASE_ICONS[phaseLabel] ?? "?";
  const deps = task.blockedBy.length > 0 ? ` → ${task.blockedBy.join(", ")}` : "";
  return `${icon} ${phaseIcon} [${task.id}] ${task.title}${deps}`;
}

/**
 * Formats the full board as plain text for LLM consumption.
 *
 * Produces a header with total/claimed/ready/blocked/done counts,
 * then groups tasks by status in order: claimed → ready → blocked → done.
 */
export function formatBoardText(board: KanbanBoard): string {
  const tasks = board.tasks;
  if (tasks.length === 0) return "No tasks on the board.";

  const total = tasks.length;
  const groups: { [K in TaskStatus]: Task[] } = { claimed: [], ready: [], blocked: [], done: [] };
  for (const t of tasks) {
    groups[t.status].push(t);
  }
  const { claimed, ready, blocked, done } = groups;

  const statusOrder: TaskStatus[] = ["claimed", "ready", "blocked", "done"];
  const lines: string[] = [];

  // Header
  lines.push(
    `📋 Kanban Board — ${total} total, ${claimed.length} claimed, ${ready.length} ready, ${blocked.length} blocked, ${done.length} done`,
  );

  for (const status of statusOrder) {
    const group = groups[status];
    if (group.length === 0) continue;

    lines.push("");
    lines.push(`── ${status.toUpperCase()} ──`);
    for (const task of group) {
      lines.push(formatTaskText(task));
    }
  }

  return lines.join("\n");
}

/**
 * Formats a single task in detail for claim confirmation.
 *
 * Multi-line format with id, title, phase, profile, files, description.
 */
export function formatClaimTaskDetail(task: Task): string {
  const phase = formatPhaseLabel(task);
  const files = task.files.length > 0 ? task.files.map((f) => `  📄 ${f}`).join("\n") : "  (none)";
  return [
    `📌 Task: ${task.id}`,
    `   Title: ${task.title}`,
    `   Phase: ${phase}`,
    `   Profile: ${task.profile}`,
    `   Files:`,
    files,
    `   Description: ${task.description}`,
  ].join("\n");
}

// ── Themed Formatting (for TUI rendering) ──

/**
 * Maps a task status to a themed (colored) icon string.
 */
export function getStatusIcon(status: TaskStatus, theme: Theme): string {
  switch (status) {
    case "blocked":
      return theme.fg("error", STATUS_ICONS.blocked);
    case "ready":
      return theme.fg("success", STATUS_ICONS.ready);
    case "claimed":
      return theme.fg("warning", STATUS_ICONS.claimed);
    case "done":
      return theme.fg("dim", STATUS_ICONS.done);
  }
}

/**
 * Maps a phase name to a themed emoji icon.
 *
 * Uses PHASE_ICONS lookup, falling back to a neutral icon for unknown phases.
 */
export function getPhaseIcon(phase: string, theme: Theme): string {
  const icon = PHASE_ICONS[phase];
  if (!icon) return theme.fg("muted", "?");
  return theme.fg("text", icon);
}

/**
 * Renders the full board as themed text for TUI display.
 *
 * Themed version of formatBoardText with colored status icons and phase icons.
 */
export function renderBoard(board: KanbanBoard, theme: Theme): string {
  const tasks = board.tasks;
  if (tasks.length === 0) return theme.fg("dim", "No tasks on the board.");

  const total = tasks.length;
  const groups: { [K in TaskStatus]: Task[] } = { claimed: [], ready: [], blocked: [], done: [] };
  for (const t of tasks) {
    groups[t.status].push(t);
  }
  const { claimed, ready, blocked, done } = groups;

  const statusOrder: TaskStatus[] = ["claimed", "ready", "blocked", "done"];
  const lines: string[] = [];

  // Header
  lines.push(
    theme.bold(
      `📋 Kanban Board — ${total} total, ${theme.fg("warning", `${claimed.length} claimed`)}, ${theme.fg("success", `${ready.length} ready`)}, ${theme.fg("error", `${blocked.length} blocked`)}, ${theme.fg("dim", `${done.length} done`)}`,
    ),
  );

  for (const status of statusOrder) {
    const group = groups[status];
    if (group.length === 0) continue;

    lines.push("");
    lines.push(theme.fg("accent", `── ${status.toUpperCase()} ──`));

    for (const task of group) {
      const icon = getStatusIcon(task.status, theme);
      const shortId = task.id;
      const phaseLabel = formatPhaseLabel(task);
      const phaseIcon = getPhaseIcon(phaseLabel, theme);

      // For done tasks, apply strikethrough to the title
      const title =
        task.status === "done"
          ? theme.fg("dim", theme.strikethrough(task.title))
          : theme.fg("text", task.title);

      const depsStyled =
        task.blockedBy.length > 0 ? theme.fg("muted", ` → ${task.blockedBy.join(", ")}`) : "";

      lines.push(
        `${icon} ${phaseIcon} ${theme.fg("accent", `[${shortId}]`)} ${title}${depsStyled}`,
      );
    }
  }

  return lines.join("\n");
}

// ── Tool Result Renderer ──

/**
 * Shared renderResult for all kanban tools.
 *
 * Renders the board as themed text, or displays error if present.
 * Falls back to plain content text if no details are available.
 */
export function renderToolResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  _options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  _context: unknown,
): Text {
  const details = result.details as KanbanDetails | undefined;

  if (!details) {
    const text = result.content[0]?.text ?? "";
    return new Text(text, 0, 0);
  }

  if (details.error) {
    return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
  }

  if (details.board) {
    return new Text(renderBoard(details.board, theme), 0, 0);
  }

  // Board is null (e.g., empty list)
  return new Text(theme.fg("dim", "No tasks on the board."), 0, 0);
}
