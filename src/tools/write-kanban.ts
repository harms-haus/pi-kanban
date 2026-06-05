/**
 * write_kanban Tool
 *
 * Modifies an existing kanban board or creates one via four modes:
 * replace, append, edit, delete.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails, Task, Phase } from "../types";
import {
  ALL_PHASES,
  MAX_TASKS,
  MAX_TITLE_LENGTH,
  MAX_IDS_IN_CALL,
  DEFAULT_PROFILE_MAP,
} from "../types";
import {
  getBoard,
  setBoard,
  resolveBlockedByTitles,
  computeInitialStatuses,
  recomputeStatuses,
  resolveTaskProfile,
} from "../state";
import { validatePhases, detectCycles, cloneBoard } from "../validation";
import { loadSettings } from "../settings";
import { formatBoardText, renderToolResult } from "../formatting";
import { publishKanbanStatus } from "../status";

// ── Types ──

/** Shape of a single task input (for replace/append modes) */
type TaskInput = {
  title: string;
  description: string;
  files?: string[];
  phases?: string[];
  blockedBy?: string[];
};

/** Shape of an edit entry */
type EditInput = { id: string; set: Record<string, unknown> };

// ── Schema ──

const TaskInputSchema = Type.Object({
  title: Type.String({
    maxLength: MAX_TITLE_LENGTH,
    description: "Short title for the task",
  }),
  description: Type.String({
    maxLength: 10000,
    description: "Fully detailed, unambiguous task description",
  }),
  files: Type.Optional(
    Type.Array(Type.String({ maxLength: 500 }), {
      maxItems: 50,
      description: "File paths relevant to the task",
    }),
  ),
  phases: Type.Optional(
    Type.Array(StringEnum(ALL_PHASES), {
      description: "Phases: subset of test, implement, review. Default: implement",
    }),
  ),
  blockedBy: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 20,
      description: "Task IDs or titles this task depends on",
    }),
  ),
});

const EditEntrySchema = Type.Object({
  id: Type.String({ description: "Task ID to edit (e.g. kb-3)" }),
  set: Type.Object(
    {
      title: Type.Optional(Type.String({ maxLength: MAX_TITLE_LENGTH })),
      description: Type.Optional(Type.String({ maxLength: 10000 })),
      files: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 50 })),
      phases: Type.Optional(Type.Array(StringEnum(ALL_PHASES))),
      blockedBy: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
    },
    { additionalProperties: false },
  ),
});

const WriteKanbanParams = Type.Object({
  mode: StringEnum(["replace", "append", "edit", "delete"], {
    description:
      "replace: Create a new board (errors if one already exists). append: Add tasks to an existing board. edit: Modify existing tasks. delete: Remove tasks by ID.",
  }),
  tasks: Type.Optional(
    Type.Array(TaskInputSchema, {
      maxItems: MAX_TASKS,
      description: "Tasks to create/append. Required for replace and append modes.",
    }),
  ),
  profileMap: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Override the default phase → subagent profile mapping.",
    }),
  ),
  edits: Type.Optional(
    Type.Array(EditEntrySchema, {
      maxItems: MAX_IDS_IN_CALL,
      description: "Edit entries. Required for edit mode.",
    }),
  ),
  ids: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: MAX_IDS_IN_CALL,
      description: "Task IDs to delete. Required for delete mode.",
    }),
  ),
});

// ── Execute Logic ──

/**
 * Build Task objects from input data, validating phases.
 */
function buildTasks(
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

/**
 * Core execute logic for write_kanban replace mode.
 */
async function executeReplace(
  params: {
    tasks: Array<{
      title: string;
      description: string;
      files?: string[];
      phases?: string[];
      blockedBy?: string[];
    }>;
    profileMap?: Record<string, string>;
  },
  ctx: ExtensionContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: KanbanDetails }> {
  // 1. Check that no board already exists
  if (getBoard() !== null) {
    throw new Error(
      "Board already exists. Use advance_tasks/reject_tasks to modify tasks, or write_kanban with append/edit/delete modes.",
    );
  }

  // 2. Merge profileMaps and load settings
  const { profileMap, maxClaims } = await mergeProfileMap(ctx.cwd, params.profileMap);

  // 3. Build tasks with IDs starting at 1
  const tasks = buildTasks(params.tasks, 1);

  // 4. Resolve blocked-by titles → IDs
  const resolveResult = resolveBlockedByTitles(tasks);
  if (!resolveResult.success) {
    throw new Error(resolveResult.error);
  }

  // 5. Cycle detection
  const cycleError = detectCycles(tasks);
  if (cycleError) {
    throw new Error(cycleError);
  }

  // 6. Create board
  const board: KanbanBoard = {
    tasks,
    profileMap,
    maxClaims,
    createdAt: Date.now(),
    nextId: tasks.length + 1,
  };

  // 7. Compute initial statuses
  computeInitialStatuses(board);

  // 8. Resolve profiles
  for (const task of board.tasks) {
    task.profile = resolveTaskProfile(task, profileMap);
  }

  // 9. Persist and publish
  setBoard(board);
  publishKanbanStatus(board, ctx);

  return {
    content: [
      {
        type: "text" as const,
        text: `Created board with ${tasks.length} task(s)\n\n${formatBoardText(board)}`,
      },
    ],
    details: { action: "write" as const, board: cloneBoard(board) },
  };
}

/**
 * Core execute logic for write_kanban append mode.
 */
function executeAppend(
  params: {
    tasks: Array<{
      title: string;
      description: string;
      files?: string[];
      phases?: string[];
      blockedBy?: string[];
    }>;
    profileMap?: Record<string, string>;
  },
  ctx: ExtensionContext,
): { content: Array<{ type: "text"; text: string }>; details: KanbanDetails } {
  // 1. Board must exist
  const board = getBoard();
  if (!board) {
    throw new Error("No board exists. Use write_kanban with mode 'replace' to create one.");
  }

  // 2. Check MAX_TASKS limit
  if (board.tasks.length + params.tasks.length > MAX_TASKS) {
    throw new Error(
      `Cannot append ${params.tasks.length} task(s): board would exceed ${MAX_TASKS} task limit (currently ${board.tasks.length}).`,
    );
  }

  // 3. Build new tasks starting from board.nextId
  const newTasks = buildTasks(params.tasks, board.nextId);

  // 4. Combine existing + new for validation
  const allTasks = [...board.tasks, ...newTasks];

  // 5. Compute merged profileMap without mutating board yet
  const mergedProfileMap = params.profileMap
    ? { ...board.profileMap, ...params.profileMap }
    : board.profileMap;

  // 6. Resolve blockedBy on combined array (before cycle detection)
  const resolveResult = resolveBlockedByTitles(allTasks);
  if (!resolveResult.success) {
    throw new Error(resolveResult.error);
  }

  // 7. Cycle detection on combined array (after title resolution)
  const cycleError = detectCycles(allTasks);
  if (cycleError) {
    throw new Error(cycleError);
  }

  // 8. Commit profileMap mutation now that validation has passed
  if (params.profileMap) {
    board.profileMap = mergedProfileMap;
  }

  // 9. Add new tasks and update nextId
  board.tasks.push(...newTasks);
  board.nextId += newTasks.length;

  // 9. Recompute statuses
  recomputeStatuses(board);

  // 10. Resolve profiles for new tasks
  for (const task of newTasks) {
    task.profile = resolveTaskProfile(task, board.profileMap);
  }

  // 11. Persist and publish
  publishKanbanStatus(board, ctx);

  return {
    content: [
      {
        type: "text" as const,
        text: `Appended ${newTasks.length} task(s) to board\n\n${formatBoardText(board)}`,
      },
    ],
    details: { action: "write" as const, board: cloneBoard(board) },
  };
}

/** Edit entry type for internal use */
type EditEntry = { id: string; set: Record<string, unknown> };

/**
 * Validate edit entries atomically, collecting all errors.
 */
function validateEditEntries(
  board: KanbanBoard,
  uniqueEdits: EditEntry[],
): { taskMap: Map<string, Task>; errors: string[] } {
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
  const errors: string[] = [];

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) {
      errors.push(`task "${edit.id}" not found`);
      continue;
    }

    const setFields = Object.keys(edit.set).filter((k) => edit.set[k] !== undefined);
    if (setFields.length === 0) {
      errors.push(`edit for task "${edit.id}" has empty set`);
      continue;
    }

    if (edit.set.phases !== undefined) {
      const phaseResult = validatePhases(edit.set.phases);
      if (!phaseResult.valid) {
        errors.push(`invalid phases for task "${edit.id}": ${phaseResult.error}`);
      }
    }
  }

  return { taskMap, errors };
}

/**
 * Apply a single edit to a task, returning change flags.
 */
function applyEditToTask(
  task: Task,
  edit: EditEntry,
): { blockedByChanged: boolean; phasesChanged: boolean } {
  let blockedByChanged = false;
  let phasesChanged = false;

  if (edit.set.title !== undefined) task.title = edit.set.title as string;
  if (edit.set.description !== undefined) task.description = edit.set.description as string;
  if (edit.set.files !== undefined) task.files = edit.set.files as string[];

  if (edit.set.phases !== undefined) {
    const phaseResult = validatePhases(edit.set.phases);
    if (!phaseResult.valid) {
      throw new Error(`invalid phases for task "${edit.id}": ${phaseResult.error}`);
    }
    task.phases = phaseResult.phases;
    phasesChanged = true;

    if (task.currentPhaseIndex >= task.phases.length) {
      task.currentPhaseIndex = task.phases.length - 1;
    }
  }

  if (edit.set.blockedBy !== undefined) {
    task.blockedBy = edit.set.blockedBy as string[];
    blockedByChanged = true;
  }

  return { blockedByChanged, phasesChanged };
}

/**
 * Rollback mutated tasks to their pre-edit snapshots.
 */
function rollbackEdits(
  taskMap: Map<string, Task>,
  snapshots: Map<
    string,
    { title: string; description: string; files: string[]; phases: Phase[]; blockedBy: string[] }
  >,
): void {
  for (const [id, snap] of snapshots) {
    const task = taskMap.get(id);
    if (task) Object.assign(task, snap);
  }
}

/**
 * Core execute logic for write_kanban edit mode.
 */
function executeEdit(
  params: { edits: Array<{ id: string; set: Record<string, unknown> }> },
  ctx: ExtensionContext,
): { content: Array<{ type: "text"; text: string }>; details: KanbanDetails } {
  const board = getBoard();
  if (!board) {
    throw new Error("No board exists. Use write_kanban with mode 'replace' to create one.");
  }

  const uniqueEdits = [...new Map(params.edits.map((e) => [e.id, e])).values()];

  const { taskMap, errors } = validateEditEntries(board, uniqueEdits);
  if (errors.length > 0) {
    throw new Error(`Cannot edit: ${errors.join("; ")}`);
  }

  // Snapshot original values for rollback on validation failure
  const snapshots = new Map<
    string,
    { title: string; description: string; files: string[]; phases: Phase[]; blockedBy: string[] }
  >();

  let blockedByChanged = false;
  let phasesChanged = false;

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;
    snapshots.set(edit.id, {
      title: task.title,
      description: task.description,
      files: [...task.files],
      phases: [...task.phases],
      blockedBy: [...task.blockedBy],
    });
    const result = applyEditToTask(task, edit);
    blockedByChanged = blockedByChanged || result.blockedByChanged;
    phasesChanged = phasesChanged || result.phasesChanged;
  }

  // Validate blocked-by references and cycle-free graph (rollback if invalid)
  let validationError: string | null = null;
  if (blockedByChanged) {
    const resolveResult = resolveBlockedByTitles(board.tasks);
    if (!resolveResult.success) {
      validationError = resolveResult.error;
    } else {
      validationError = detectCycles(board.tasks);
    }
  }

  if (validationError) {
    rollbackEdits(taskMap, snapshots);
    throw new Error(validationError);
  }

  if (blockedByChanged || phasesChanged) {
    recomputeStatuses(board);
  }

  for (const edit of uniqueEdits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;
    task.profile = resolveTaskProfile(task, board.profileMap);
  }

  publishKanbanStatus(board, ctx);

  return {
    content: [
      {
        type: "text" as const,
        text: `Edited ${uniqueEdits.length} task(s)\n\n${formatBoardText(board)}`,
      },
    ],
    details: { action: "write" as const, board: cloneBoard(board) },
  };
}

/**
 * Core execute logic for write_kanban delete mode.
 */
function executeDelete(
  params: { ids: string[] },
  ctx: ExtensionContext,
): { content: Array<{ type: "text"; text: string }>; details: KanbanDetails } {
  // 1. Board must exist
  const board = getBoard();
  if (!board) {
    throw new Error("No board exists. Use write_kanban with mode 'replace' to create one.");
  }

  // 2. Deduplicate IDs
  const uniqueIds = [...new Set(params.ids)];

  // 3. Atomic validation: all IDs must exist
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
  const errors: string[] = [];
  for (const id of uniqueIds) {
    if (!taskMap.has(id)) {
      errors.push(`task "${id}" not found`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Cannot delete: ${errors.join("; ")}`);
  }

  // 4. Remove matching tasks
  const deletedSet = new Set(uniqueIds);
  board.tasks = board.tasks.filter((t) => !deletedSet.has(t.id));

  // 5. Clean up blockedBy references
  for (const task of board.tasks) {
    task.blockedBy = task.blockedBy.filter((depId) => !deletedSet.has(depId));
  }

  // 6. Recompute statuses
  recomputeStatuses(board);

  // 7. Publish status
  publishKanbanStatus(board, ctx);

  return {
    content: [
      {
        type: "text" as const,
        text: `Deleted ${uniqueIds.length} task(s)\n\n${formatBoardText(board)}`,
      },
    ],
    details: { action: "write" as const, board: cloneBoard(board) },
  };
}

// ── Tool Factory ──

export function writeKanbanTool(): ToolDefinition<typeof WriteKanbanParams, KanbanDetails> {
  return {
    name: "write_kanban",
    label: "Write Kanban Board",
    description:
      "Create or modify a kanban board with tasks organized by phases (test, implement, review) with dependency tracking.\n\n" +
      "Four modes:\n" +
      "- replace: Create a new board (errors if one already exists)\n" +
      "- append: Add tasks to an existing board\n" +
      "- edit: Modify existing tasks (title, description, files, phases, blockedBy)\n" +
      "- delete: Remove tasks by ID",
    parameters: WriteKanbanParams,
    promptSnippet: "Create or modify a kanban board with tasks, phases, and dependency tracking",
    promptGuidelines: [
      "Use write_kanban with mode 'replace' to create a new board when starting a new task plan. Only one board can exist at a time.",
      "Use write_kanban with mode 'append' to add tasks to an existing board.",
      "Use write_kanban with mode 'edit' to modify existing tasks. Only provided fields in 'set' are changed.",
      "Use write_kanban with mode 'delete' to remove tasks by ID. Dependencies on deleted tasks are automatically cleaned up.",
      "Each task has a short title and a fully detailed description for subagents.",
      "Set phases for each task (default: implement). Use multiple phases (test, implement, review) for complex tasks.",
      "Use blockedBy to express dependencies between tasks. Tasks without blockers start as ready.",
      "Use profileMap to override the default phase → subagent profile mapping if needed.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Validate mode-specific requirements (can't be expressed in flat schema)
      if (
        (params.mode === "replace" || params.mode === "append") &&
        (!params.tasks || params.tasks.length === 0)
      ) {
        throw new Error(`Mode '${params.mode}' requires a non-empty 'tasks' array.`);
      }
      if (params.mode === "edit" && (!params.edits || params.edits.length === 0)) {
        throw new Error("Mode 'edit' requires a non-empty 'edits' array.");
      }
      if (params.mode === "delete" && (!params.ids || params.ids.length === 0)) {
        throw new Error("Mode 'delete' requires a non-empty 'ids' array.");
      }

      switch (params.mode) {
        case "replace":
          return executeReplace(
            { tasks: params.tasks as TaskInput[], profileMap: params.profileMap },
            ctx,
          );
        case "append":
          return executeAppend(
            { tasks: params.tasks as TaskInput[], profileMap: params.profileMap },
            ctx,
          );
        case "edit":
          return executeEdit({ edits: params.edits as EditInput[] }, ctx);
        case "delete":
          return executeDelete({ ids: params.ids as string[] }, ctx);
        default:
          throw new Error(`Unknown write_kanban mode: ${(params as { mode: string }).mode}`);
      }
    },

    renderCall(params, theme) {
      switch (params.mode) {
        case "replace":
        case "append":
          return new Text(
            theme.fg(
              "accent",
              `📋 write_kanban (mode: ${params.mode}, ${params.tasks?.length ?? 0} tasks)`,
            ),
            0,
            0,
          );
        case "edit":
          return new Text(
            theme.fg("accent", `📋 write_kanban (mode: edit, ${params.edits?.length ?? 0} edits)`),
            0,
            0,
          );
        case "delete":
          return new Text(
            theme.fg("accent", `📋 write_kanban (mode: delete, ${params.ids?.length ?? 0} ids)`),
            0,
            0,
          );
        default:
          return new Text(theme.fg("accent", "📋 write_kanban"), 0, 0);
      }
    },

    renderResult: renderToolResult,
  };
}
