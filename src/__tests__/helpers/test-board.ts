import { resetState, setBoard } from "../../state";
import type { KanbanBoard, Task } from "../../types";
import { DEFAULT_PROFILE_MAP, DEFAULT_MAX_CLAIMS } from "../../types";

let taskCounter = 0;

export function resetTestCounters(): void {
  taskCounter = 0;
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `kb-${++taskCounter}`,
    title: "Test task",
    description: "Test description for the task",
    files: [],
    phases: ["implement"],
    currentPhaseIndex: 0,
    status: "ready",
    blockedBy: [],
    profile: "task-worker",
    ...overrides,
  };
}

export function makeBoard(tasks: Task[] = [], overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    tasks,
    profileMap: { ...DEFAULT_PROFILE_MAP },
    maxClaims: DEFAULT_MAX_CLAIMS,
    createdAt: Date.now(),
    nextId:
      tasks.length > 0
        ? Math.max(
            ...tasks.map((t) => {
              const n = parseInt(t.id.slice(3), 10);
              return Number.isNaN(n) ? 0 : n;
            }),
          ) + 1
        : 1,
    ...overrides,
  };
}

export function setupBoard(tasks: Task[], overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  resetState();
  const board = makeBoard(tasks, overrides);
  setBoard(board);
  return board;
}

export function noop(): void {}
export const mockSignal = new AbortController().signal;
