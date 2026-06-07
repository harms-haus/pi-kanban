/**
 * write_kanban — replace mode
 *
 * Creates a new kanban board, overwriting any existing one.
 */

import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails, Task } from "../types";
import { DEFAULT_PROFILE_MAP } from "../types";
import { setBoard, recomputeStatuses } from "../state";
import { resolveBlockedByTitles } from "../resolve-deps";
import { resolveTaskProfile } from "../resolve-profile";
import { validatePhases, detectCycles } from "../validation";
import { loadSettings } from "../settings";
import { formatBoardText } from "../formatting";
import { finishMutation } from "../helpers";

// ── Types ──

/** Shape of a single task input (for replace/append modes) */
export type TaskInput = {
  title: string;
  description: string;
  files?: string[];
  phases?: string[];
  blockedBy?: string[];
};

// ── Helpers ──

/**
 * Build Task objects from input data, validating phases.
 */
export function buildTasks(
  inputs: Array<{
    title: string;
    description: string;
    files?: string[];
    phases?: string[];
    blockedBy?: string[];
  }>,
  startId: number,
): Task[] {
  const tasks: Task[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const inputTask = inputs[i];
    if (!inputTask) continue;

    const phasesInput = inputTask.phases ?? ["implement"];
    const phaseResult = validatePhases(phasesInput);
    if (!phaseResult.valid) {
      throw new Error(`Invalid phases for task "${inputTask.title}": ${phaseResult.error}`);
    }

    const task: Task = {
      id: `kb-${startId + i}`,
      title: inputTask.title,
      description: inputTask.description,
      files: inputTask.files ?? [],
      phases: phaseResult.phases,
      currentPhaseIndex: 0,
      status: "blocked",
      blockedBy: inputTask.blockedBy ?? [],
      profile: "",
    };

    tasks.push(task);
  }

  return tasks;
}

/**
 * Load settings and merge profileMaps.
 */
async function mergeProfileMap(
  cwd: string,
  paramsProfileMap?: Record<string, string>,
): Promise<{ profileMap: Record<string, string>; maxClaims: number }> {
  const settings = await loadSettings(cwd);
  return {
    profileMap: {
      ...DEFAULT_PROFILE_MAP,
      ...settings.profileMap,
      ...(paramsProfileMap ?? {}),
    },
    maxClaims: settings.maxClaims,
  };
}

// ── Execute ──

/**
 * Core execute logic for write_kanban replace mode.
 */
export async function executeReplace(
  params: {
    tasks: TaskInput[];
    profileMap?: Record<string, string>;
  },
  ctx: ExtensionContext,
): Promise<AgentToolResult<KanbanDetails>> {
  // 1. Merge profileMaps and load settings
  const { profileMap, maxClaims } = await mergeProfileMap(ctx.cwd, params.profileMap);

  // 2. Build tasks with IDs starting at 1
  const tasks = buildTasks(params.tasks, 1);

  // 3. Resolve blocked-by titles → IDs
  const resolveResult = resolveBlockedByTitles(tasks);
  if (!resolveResult.success) {
    throw new Error(resolveResult.error);
  }

  // 4. Cycle detection
  const cycleError = detectCycles(tasks);
  if (cycleError) {
    throw new Error(cycleError);
  }

  // 5. Create board
  const board: KanbanBoard = {
    tasks,
    profileMap,
    maxClaims,
    createdAt: Date.now(),
    nextId: tasks.length + 1,
  };

  // 6. Compute initial statuses
  recomputeStatuses(board);

  // 7. Resolve profiles
  for (const task of board.tasks) {
    task.profile = resolveTaskProfile(task, profileMap);
  }

  // 8. Persist
  setBoard(board);

  return finishMutation(
    board,
    ctx,
    "write",
    `Created board with ${tasks.length} task(s)\n\n${formatBoardText(board)}`,
  );
}
