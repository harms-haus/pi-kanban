import type { KanbanBoard, Task } from "../../types";
import { DEFAULT_PROFILE_MAP, DEFAULT_MAX_CLAIMS } from "../../types";
import { randomUUID } from "node:crypto";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: randomUUID(),
    title: "Test task",
    description: "A test task description",
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
    ...overrides,
  };
}
