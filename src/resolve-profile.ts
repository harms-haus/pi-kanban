/**
 * Task Profile Resolution
 *
 * Resolves the subagent profile for a task's current phase.
 */

import type { Task } from "./types";
import { resolveProfile } from "./settings";

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
