/**
 * Kanban Validation
 *
 * Runtime type guards and validation utilities for the kanban board.
 */

import type { Phase, Task, TaskStatus, KanbanBoard } from "./types";
import { VALID_PHASES, VALID_STATUSES, MAX_TITLE_LENGTH, ALL_PHASES } from "./types";

// ── Validation Helpers ────────────────────────────────────────────────

/** Type guard: checks that value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard: checks that value is a valid Phase. */
function isValidPhase(value: unknown): value is Phase {
  if (typeof value !== "string") return false;
  return (VALID_PHASES as ReadonlySet<string>).has(value);
}

/** Type guard: checks that value is a valid TaskStatus. */
function isValidStatus(value: unknown): value is TaskStatus {
  if (typeof value !== "string") return false;
  return (VALID_STATUSES as ReadonlySet<string>).has(value);
}

/** Checks that value is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Type guard: checks that value is either undefined or a non-empty string. */
function isValidOptionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

/** Type guard: checks that a done-status task has currentPhaseIndex === -1. */
function isConsistentDoneStatus(currentPhaseIndex: unknown, status: unknown): boolean {
  return !(currentPhaseIndex === -1 && status !== "done");
}

/** Checks that value is a non-empty array of valid Phase strings. */
function isValidPhasesArray(value: unknown): value is Phase[] {
  return Array.isArray(value) && value.length > 0 && value.every(isValidPhase);
}

/** Type guard: checks that value is a valid title string (non-empty, within limit). */
function isValidTitle(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TITLE_LENGTH;
}

/** Checks that obj has a valid currentPhaseIndex integer relative to phases.length. */
function isValidCurrentPhaseIndex(idx: unknown, phasesLen: number): idx is number {
  return typeof idx === "number" && Number.isInteger(idx) && idx >= -1 && idx < phasesLen;
}

/**
 * Type guard: validates that `obj` is a well-formed Task.
 *
 * Checks all required fields and their types, including:
 * - id: non-empty string
 * - title: string with length 1..MAX_TITLE_LENGTH
 * - description: non-empty string
 * - files: array of strings
 * - phases: non-empty array of valid Phase strings
 * - currentPhaseIndex: integer >= -1, < phases.length
 * - status: valid TaskStatus
 * - If currentPhaseIndex === -1, status must be "done"
 * - blockedBy: array of strings
 * - profile: non-empty string
 */
export function isValidTask(obj: unknown): obj is Task {
  if (typeof obj !== "object" || obj === null) return false;
  const t = obj as Record<string, unknown>;

  // id: non-empty string
  if (!isNonEmptyString(t.id)) return false;

  // title: string 1..MAX_TITLE_LENGTH
  if (!isValidTitle(t.title)) return false;

  // description: non-empty string
  if (!isNonEmptyString(t.description)) return false;

  // files: array of strings
  if (!isStringArray(t.files)) return false;

  // phases: non-empty array of valid Phase strings
  if (!Array.isArray(t.phases) || !isValidPhasesArray(t.phases)) return false;

  // currentPhaseIndex: integer >= -1, < phases.length
  if (!isValidCurrentPhaseIndex(t.currentPhaseIndex, t.phases.length)) return false;

  // status: valid TaskStatus
  if (!isValidStatus(t.status)) return false;

  // If currentPhaseIndex === -1, status must be "done"
  if (!isConsistentDoneStatus(t.currentPhaseIndex, t.status)) return false;

  // blockedBy: array of strings
  if (!isStringArray(t.blockedBy)) return false;

  // profile: non-empty string
  if (!isNonEmptyString(t.profile)) return false;

  // reason: optional string
  if (!isValidOptionalString(t.reason)) return false;

  return true;
}

/**
 * Validates a phases array for correctness.
 *
 * Checks that `phases` is a non-empty array of valid Phase strings
 * and that they appear in the same order as ALL_PHASES (subsequence check).
 *
 * Uses a two-pointer approach: walks through ALL_PHASES and checks
 * each input phase appears in order.
 */
export function validatePhases(
  phases: unknown,
): { valid: true; phases: Phase[] } | { valid: false; error: string } {
  if (!Array.isArray(phases) || phases.length === 0) {
    return { valid: false, error: "phases must be a non-empty array" };
  }

  const strings: string[] = [];

  // Two-pointer: walk through ALL_PHASES, matching input phases in order
  let allIndex = 0;
  for (let i = 0; i < phases.length; i++) {
    const raw: unknown = phases[i];
    if (typeof raw !== "string") {
      return { valid: false, error: `invalid phase: ${String(raw)}` };
    }
    if (!(VALID_PHASES as ReadonlySet<string>).has(raw)) {
      return { valid: false, error: `invalid phase: ${raw}` };
    }

    // Advance allIndex until we find this phase in ALL_PHASES
    while (allIndex < ALL_PHASES.length && ALL_PHASES[allIndex] !== raw) {
      allIndex++;
    }

    if (allIndex >= ALL_PHASES.length) {
      return {
        valid: false,
        error: `phases not in canonical order: "${raw}" appears out of order`,
      };
    }

    strings.push(raw);
    allIndex++; // Move past this match so next phase must come after
  }

  // Cast through unknown since string[] → Phase[] is a narrowing cast
  return { valid: true, phases: strings } as unknown as ReturnType<typeof validatePhases>;
}

/**
 * DFS-based cycle detection on the blockedBy dependency graph.
 *
 * Returns null if no cycles are found, or an error string describing the cycle.
 */
export function detectCycles(tasks: Array<{ id: string; blockedBy: string[] }>): string | null {
  const taskIds = new Set(tasks.map((t) => t.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  // Build adjacency: task → tasks it blocks (reverse of blockedBy)
  function dfs(taskId: string, path: string[]): string | null {
    if (inStack.has(taskId)) {
      const cycleStart = path.indexOf(taskId);
      const cycle = path.slice(cycleStart).concat(taskId).join(" → ");
      return `cycle detected: ${cycle}`;
    }
    if (visited.has(taskId)) return null;

    visited.add(taskId);
    inStack.add(taskId);
    path.push(taskId);

    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      for (const depId of task.blockedBy) {
        if (!taskIds.has(depId)) continue; // skip unknown IDs
        const cycle = dfs(depId, path);
        if (cycle) return cycle;
      }
    }

    path.pop();
    inStack.delete(taskId);
    return null;
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const cycle = dfs(task.id, []);
      if (cycle) return cycle;
    }
  }

  return null;
}

/** Deep-clone a KanbanBoard using structuredClone */
export function cloneBoard(board: KanbanBoard): KanbanBoard {
  return structuredClone(board);
}
