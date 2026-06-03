/**
 * create_kanban Tool
 *
 * Creates a new kanban board with tasks, phases, and dependency tracking.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KanbanBoard, KanbanDetails, Task } from "../types";
import { ALL_PHASES, MAX_TASKS, MAX_TITLE_LENGTH, DEFAULT_PROFILE_MAP } from "../types";
import {
  getBoard,
  setBoard,
  resolveBlockedByTitles,
  computeInitialStatuses,
  resolveTaskProfile,
} from "../state";
import { validatePhases, detectCycles, cloneBoard } from "../validation";
import { loadSettings } from "../settings";
import { formatBoardText, renderToolResult } from "../formatting";
import { publishKanbanStatus } from "../status";

// ── Schema ──

const CreateKanbanParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
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
    }),
    { minItems: 1, maxItems: MAX_TASKS },
  ),
  profileMap: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Override default profile mapping",
    }),
  ),
});

// ── Execute Logic ──

/**
 * Core execute logic for create_kanban.
 * Validates inputs, builds tasks, checks cycles, resolves dependencies,
 * computes statuses, and persists the new board.
 */
async function executeCreateKanban(
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
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: KanbanDetails;
}> {
  // 1. Check that no board already exists
  if (getBoard() !== null) {
    throw new Error("Board already exists. Use advance_tasks/reject_tasks to modify tasks.");
  }

  // 2. Load settings
  const settings = await loadSettings(ctx.cwd);

  // 3. Merge profileMaps: defaults → settings → params
  const profileMap = {
    ...DEFAULT_PROFILE_MAP,
    ...settings.profileMap,
    ...(params.profileMap ?? {}),
  };

  // 4. Build Task objects
  const tasks: Task[] = [];

  for (const inputTask of params.tasks) {
    // Validate phases
    const phasesInput = inputTask.phases ?? ["implement"];
    const phaseResult = validatePhases(phasesInput);
    if (!phaseResult.valid) {
      throw new Error(`Invalid phases for task "${inputTask.title}": ${phaseResult.error}`);
    }

    const task: Task = {
      id: `kb-${tasks.length + 1}`,
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

  // 5. Cycle detection
  const cycleError = detectCycles(tasks);
  if (cycleError) {
    throw new Error(cycleError);
  }

  // 6. Resolve blocked-by titles → IDs
  const resolveResult = resolveBlockedByTitles(tasks);
  if (!resolveResult.success) {
    throw new Error(resolveResult.error);
  }

  // 7. Create KanbanBoard
  const board: KanbanBoard = {
    tasks,
    profileMap,
    maxClaims: settings.maxClaims,
    createdAt: Date.now(),
  };

  // 8. Compute initial statuses
  computeInitialStatuses(board);

  // 9. Resolve each task's profile
  for (const task of board.tasks) {
    task.profile = resolveTaskProfile(task, profileMap);
  }

  // 10. Persist board
  setBoard(board);

  // 11. Publish status to UI
  publishKanbanStatus(board, ctx);

  return {
    content: [
      {
        type: "text" as const,
        text: `Created board with ${tasks.length} task(s)\n\n${formatBoardText(board)}`,
      },
    ],
    details: { action: "create" as const, board: cloneBoard(board) },
  };
}

// ── Tool Factory ──

export function createKanbanTool(): ToolDefinition<typeof CreateKanbanParams, KanbanDetails> {
  return {
    name: "create_kanban",
    label: "Create Kanban Board",
    description:
      "Create a kanban board with tasks organized by phases (test, implement, review) with dependency tracking. Each task goes through its phases in order, and tasks blocked by others wait until their dependencies are done. There can only be one board at a time — calling this when a board already exists throws an error.",
    parameters: CreateKanbanParams,
    promptSnippet: "Create a kanban board with tasks, phases, and dependency tracking",
    promptGuidelines: [
      "Use create_kanban to create a new board when starting a new task plan. Only one board can exist at a time — calling this when a board already exists throws an error.",
      "Each task has a short title and a fully detailed description for subagents.",
      "Set phases for each task (default: implement). Use multiple phases (test, implement, review) for complex tasks.",
      "Use blockedBy to express dependencies between tasks. Tasks without blockers start as ready.",
      "Use profileMap to override the default phase → subagent profile mapping if needed.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeCreateKanban(params, ctx);
    },

    renderCall(params, theme) {
      return new Text(theme.fg("accent", `📋 create_kanban (${params.tasks.length} tasks)`), 0, 0);
    },

    renderResult: renderToolResult,
  };
}
