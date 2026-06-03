/** The ordered phases a task can go through before being done */
export type Phase = "test" | "implement" | "review";

/** Lifecycle status of a task */
export type TaskStatus = "blocked" | "ready" | "claimed" | "done";

/** A single task on the kanban board */
export interface Task {
  /** Unique identifier (UUID) */
  id: string;
  /** Short description (max 100 chars) */
  title: string;
  /** Fully detailed, unambiguous description for subagents */
  description: string;
  /** File paths relevant to this task */
  files: string[];
  /** Ordered phases this task goes through (subset of ALL_PHASES, preserving order) */
  phases: Phase[];
  /** Current index into phases array. -1 means done */
  currentPhaseIndex: number;
  /** Current status */
  status: TaskStatus;
  /** Task IDs that must reach 'done' before this task unblocks */
  blockedBy: string[];
  /** Resolved subagent profile name for the current phase */
  profile: string;
  /** Optional rejection reason (set by reject_tasks) */
  reason?: string;
}

/** The full kanban board */
export interface KanbanBoard {
  /** All tasks */
  tasks: Task[];
  /** Phase → profile name mapping */
  profileMap: Record<string, string>;
  /** Max concurrent claims */
  maxClaims: number;
  /** Board creation timestamp */
  createdAt: number;
}

/** Persistence envelope for tool result details */
export interface KanbanDetails {
  /** Which tool produced this entry */
  action: "create" | "list" | "claim" | "advance" | "reject";
  /** Full board snapshot (null for list on empty board) */
  board: KanbanBoard | null;
  /** Error message if tool returned an error */
  error?: string;
}

// ── Constants ──

/** All valid phases in canonical order */
export const ALL_PHASES: readonly Phase[] = ["test", "implement", "review"];

/** Default phase → profile name mapping */
export const DEFAULT_PROFILE_MAP: Record<string, string> = {
  test: "task-worker-tests",
  implement: "task-worker",
  review: "task-reviewer",
};

/** Maximum number of tasks allowed on a board */
export const MAX_TASKS = 100;

/** Maximum length of a task title */
export const MAX_TITLE_LENGTH = 100;

/** Maximum number of IDs in a single tool call */
export const MAX_IDS_IN_CALL = 50;

/** Default maximum concurrent claims */
export const DEFAULT_MAX_CLAIMS = 4;

/** Tool names that produce KanbanDetails for state reconstruction */
export const TOOL_NAMES = new Set([
  "create_kanban",
  "list_kanban",
  "claim_tasks",
  "advance_tasks",
  "reject_tasks",
]);

/** Set of valid Phase values for runtime validation */
export const VALID_PHASES = new Set<string>(ALL_PHASES) as ReadonlySet<Phase>;

/** Set of valid TaskStatus values for runtime validation */
export const VALID_STATUSES = new Set<TaskStatus>(["blocked", "ready", "claimed", "done"]);

// ── Lookup Maps ──

/** Status → icon character */
export const STATUS_ICONS: Record<TaskStatus, string> = {
  blocked: "⊘",
  ready: "○",
  claimed: "●",
  done: "✓",
};

/** Phase → icon character */
export const PHASE_ICONS: Record<string, string> = {
  test: "🧪",
  implement: "⚙️",
  review: "👁",
  done: "✓",
};
