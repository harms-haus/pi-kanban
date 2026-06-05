/**
 * write_kanban Tool
 *
 * Modifies an existing kanban board or creates one via four modes:
 * replace, append, edit, delete.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ToolDefinition, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { ALL_PHASES, MAX_TASKS, MAX_TITLE_LENGTH, MAX_IDS_IN_CALL } from "../types";
import { renderToolResult } from "../formatting";
import { executeReplace } from "./write-kanban-replace.js";
import type { TaskInput } from "./write-kanban-replace.js";
import { executeAppend } from "./write-kanban-append.js";
import { executeEdit } from "./write-kanban-edit.js";
import type { EditEntry } from "./write-kanban-edit.js";
import { executeDelete } from "./write-kanban-delete.js";

// ── Types ──

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

    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate: AgentToolUpdateCallback<KanbanDetails> | undefined,
      ctx,
    ) {
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
          return executeEdit({ edits: params.edits as EditEntry[] }, ctx);
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
