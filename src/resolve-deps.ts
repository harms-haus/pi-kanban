/**
 * Dependency Resolution
 *
 * Resolves blockedBy title references to task IDs.
 */

import type { Task } from "./types";

// ── Resolve Blocked-By Titles ──

/**
 * For each task's blockedBy entries, resolve title references to task IDs.
 *
 * Resolves titles across the entire passed array (for append mode, the caller
 * passes existing + new tasks combined). If a blockedBy entry is a valid kb-N ID
 * that matches an existing task ID, it is kept as-is. Otherwise it is treated as
 * a title and replaced with the matching task's ID.
 *
 * **Mutates** each task's `blockedBy` array in place, replacing title references
 * with resolved task IDs.
 *
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
    task.blockedBy = resolved;
  }

  return { success: true };
}
