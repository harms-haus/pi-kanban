import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type {
  Theme,
  ToolDefinition,
  ExtensionContext,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-coding-agent";
import type { KanbanDetails } from "../types";
import { MAX_IDS_IN_CALL } from "../types";
import { recomputeStatuses } from "../state";
import { resolveTaskProfile } from "../resolve-profile";
import { formatBoardText, renderToolResult } from "../formatting";
import { deduplicateIds, finishMutation } from "../helpers";
import { requireBoard } from "../guard";

// ── Schema Builder ──

function buildAdvanceTasksParams() {
  return Type.Object({
    ids: Type.Array(Type.String(), {
      minItems: 1,
      maxItems: MAX_IDS_IN_CALL,
      description: "Task IDs to advance",
    }),
  });
}

// ── Tool Factory ──

export function createAdvanceTasksTool(): ToolDefinition<
  ReturnType<typeof buildAdvanceTasksParams>,
  KanbanDetails
> {
  const params = buildAdvanceTasksParams();

  return {
    name: "advance_tasks",
    label: "Advance Tasks",
    description:
      "Advance one or more claimed tasks to their next phase. Tasks stay claimed through phase transitions. Tasks that reach the end of their phase list are marked as done.",
    promptSnippet:
      "Advance claimed tasks to the next phase, or mark as done if the current phase is the last.",
    promptGuidelines: [
      "Use advance_tasks to move claimed tasks forward through their phase lifecycle.",
      "Each call advances the task's currentPhaseIndex by 1. Tasks remain claimed between phases. If the task reaches the end of its phases array, it is marked as done.",
      "After advancement, any tasks that were blocked by the completing tasks are automatically unblocked if all their dependencies are done.",
      "All tasks in a single call are validated atomically — no changes are made if any task ID is invalid or not currently claimed.",
    ],

    parameters: params,

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(
      _toolCallId: string,
      executeParams: { ids: string[] },
      _signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<KanbanDetails> | undefined,
      ctx: ExtensionContext,
    ) {
      const board = requireBoard();

      // Deduplicate IDs
      const uniqueIds = deduplicateIds(executeParams.ids);

      // ── Atomic Validation ──
      const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
      const errors: string[] = [];
      for (const id of uniqueIds) {
        const task = taskMap.get(id);
        if (!task) {
          errors.push(`task "${id}" not found`);
        } else if (task.status !== "claimed") {
          errors.push(`task "${id}" is not claimed (current status: ${task.status})`);
        }
      }

      if (errors.length > 0) {
        throw new Error(`Cannot advance: ${errors.join("; ")}`);
      }

      // ── Advance Each Task ──
      const advanced: string[] = [];
      const completed: string[] = [];

      for (const id of uniqueIds) {
        // Validated atomically above — existence guaranteed
        const task = taskMap.get(id);
        if (!task) continue;

        task.currentPhaseIndex++;
        const shortId = task.id;

        if (task.currentPhaseIndex >= task.phases.length) {
          // Task is done
          task.currentPhaseIndex = -1;
          task.status = "done";
          task.profile = "";
          task.reason = undefined;
          completed.push(shortId);
        } else {
          // Advance to next phase
          task.status = "claimed";
          task.profile = resolveTaskProfile(task, board.profileMap);
          task.reason = undefined;
          advanced.push(shortId);
        }
      }

      // ── Unblock Dependents ──
      recomputeStatuses(board);

      // ── Build Content ──
      const lines: string[] = [];
      if (advanced.length > 0) {
        lines.push(`Advanced [${advanced.join(", ")}] to next phase.`);
      }
      if (completed.length > 0) {
        lines.push(`Completed [${completed.join(", ")}].`);
      }
      lines.push("");
      lines.push(formatBoardText(board));

      return finishMutation(board, ctx, "advance", lines.join("\n"));
    },

    renderCall(args: { ids: string[] }, theme: Theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("advance_tasks ")) +
          theme.fg("success", `→ advance (${args.ids.length} tasks)`),
        0,
        0,
      );
    },

    renderResult: renderToolResult,
  };
}
