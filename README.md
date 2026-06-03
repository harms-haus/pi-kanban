# pi-kanban

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.2.0-blue)

A pi-coding-agent extension that provides a kanban-style task board for managing parallel subagent work. Tasks flow through configurable phases (test → implement → review) with dependency tracking and automatic unblocking.

## Overview

pi-kanban gives an agent a structured task board where each task progresses through ordered phases. The agent creates a board with tasks and dependencies, claims work items (respecting concurrency limits), delegates to subagents, then advances or rejects tasks based on results.

Key capabilities:

- **Phase pipeline** — each task flows through a configurable subset of `test`, `implement`, and `review` phases in canonical order
- **Dependency tracking** — tasks can be blocked by other tasks; dependents auto-unblock when their blockers complete
- **Concurrency limits** — `maxClaims` caps the number of tasks simultaneously in-flight
- **Atomic validation** — batch operations (`advance_tasks`, `reject_tasks`) validate all IDs before mutating any state
- **State persistence** — board state is reconstructed from session history on `session_start` / `session_tree`, surviving restarts and branch switches
- **Hidden context injection** — `before_agent_start` injects the current board state into each agent turn as a non-displayed system message

## Installation

This extension requires the following peer dependencies:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

Install via npm:

```bash
npm install @harms-haus/pi-kanban
```

The extension auto-registers via the `pi.extensions` field in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Tools Reference

### `create_kanban`

Creates a new kanban board. Only one board can exist at a time — calling this throws an error if a board already exists.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tasks` | `TaskInput[]` | Yes | Array of tasks (1–100 items) |
| `profileMap` | `Record<string, string>` | No | Override default phase → profile mapping |

**TaskInput:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Short title (max 100 chars) |
| `description` | `string` | Yes | Detailed description for subagents (max 10,000 chars) |
| `files` | `string[]` | No | Relevant file paths (max 50 items, 500 chars each) |
| `phases` | `string[]` | No | Ordered subset of `test`, `implement`, `review`. Default: `["implement"]` |
| `blockedBy` | `string[]` | No | Task IDs or titles this task depends on (max 20 items). Titles are resolved to IDs at board creation time. |

Task IDs are auto-assigned in creation order as `kb-1`, `kb-2`, `kb-3`, etc. The `blockedBy` field accepts either IDs (e.g. `kb-3`) or titles (e.g. `"Set up database schema"`). Titles are resolved to IDs when the board is created.

**Example:**

```json
{
  "tool": "create_kanban",
  "parameters": {
    "tasks": [
      {
        "title": "Set up database schema",
        "description": "Create the initial migration files for the users and orders tables.",
        "files": ["src/db/migrations/"],
        "phases": ["test", "implement"]
      },
      {
        "title": "Build REST endpoints",
        "description": "Implement CRUD endpoints for users and orders, with input validation.",
        "files": ["src/routes/users.ts", "src/routes/orders.ts"],
        "phases": ["test", "implement", "review"],
        "blockedBy": ["Set up database schema"]
      }
    ],
    "profileMap": {
      "implement": "senior-dev",
      "review": "code-reviewer"
    }
  }
}
```

### `list_kanban`

Lists all tasks on the current board, grouped by status: claimed → ready → blocked → done.

**Parameters:** None.

**Example:**

```json
{
  "tool": "list_kanban",
  "parameters": {}
}
```

Returns the full board text or `"No board exists. Use create_kanban to create one."` if no board is active.

### `claim_tasks`

Claims up to `count` new ready tasks from the board, respecting the `maxClaims` limit. Always returns all currently outstanding (already claimed) tasks alongside any newly claimed ones.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `count` | `integer` | Yes | Number of new tasks to claim (min 1) |

The number of newly claimed tasks is the minimum of `count`, the number of ready tasks, and remaining capacity (`maxClaims` minus outstanding). The requested `count` refers only to new claims — outstanding tasks are always returned regardless.

**Example:**

```json
{
  "tool": "claim_tasks",
  "parameters": {
    "count": 2
  }
}
```

Each claimed task's output includes its ID, title, current phase, resolved profile, files, and full description — everything a subagent needs to execute the work.

### `advance_tasks`

Advances one or more claimed tasks to their next phase. Tasks stay claimed through phase transitions. Tasks that pass their final phase are marked `done`, and any tasks blocked by them are automatically unblocked.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | `string[]` | Yes | Task IDs to advance (1–50 items) |

All IDs are validated atomically — if any ID is invalid or not currently claimed, no tasks are advanced.

**Example:**

```json
{
  "tool": "advance_tasks",
  "parameters": {
    "ids": ["kb-1", "kb-2"]
  }
}
```

**Behavior per task:**
- `currentPhaseIndex` increments by 1
- If `currentPhaseIndex >= phases.length` → task is marked `done`
- Otherwise → task stays `claimed` at the next phase (no need to re-claim)
- For done tasks, all dependents are re-evaluated and unblocked if all their dependencies are satisfied

### `reject_tasks`

Rejects one or more claimed tasks, resetting them to phase 0 while keeping them claimed. Optionally records a rejection reason. Tasks at any phase — including the first phase — can be rejected. First-phase rejection records the reason without changing the phase index.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | `string[]` | Yes | Task IDs to reject (1–50 items) |
| `reason` | `string` | No | Reason for rejection |

All IDs are validated atomically. If any ID is invalid or not currently claimed, no tasks are rejected.

**Example:**

```json
{
  "tool": "reject_tasks",
  "parameters": {
    "ids": ["kb-3"],
    "reason": "Tests failed — missing edge case for null input"
  }
}
```

## Configuration

Settings are loaded from two locations, with project-local overriding global:

- **Global:** `~/.pi/agent/settings.json` (or `$PI_AGENT_DIR/settings.json`)
- **Project-local:** `.pi/settings.json`

Both use the `kanban` key:

```json
{
  "kanban": {
    "profileMap": {
      "test": "task-worker-tests",
      "implement": "task-worker",
      "review": "task-reviewer"
    },
    "maxClaims": 4
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `profileMap` | `Record<string, string>` | `{ test: "task-worker-tests", implement: "task-worker", review: "task-reviewer" }` | Maps phase names to subagent profile names. Always merged on top of defaults. |
| `maxClaims` | `integer` | `4` | Maximum concurrent claimed tasks. Clamped to 1–10. |

The `profileMap` can also be overridden per-board via the `profileMap` parameter in `create_kanban`. Merge order is: defaults → global settings → project settings → per-board parameter.

## Phase Flow

Each task defines an ordered list of phases drawn from the canonical pipeline:

```
test → implement → review
```

Phases must be a subsequence of this order — for example `["implement"]`, `["implement", "review"]`, or `["test", "implement", "review"]` are all valid. `["review", "test"]` is not.

### Lifecycle

```
  blocked → ready → claimed → (advance) → claimed → ... → done
                  ↑    ↑                         │
                  │    │                    (final phase)
                  │    │                         ↓
                  │    └─── (reject) ────→ claimed (phase 0)
                  │
               (unblocked when all blockers done)
```

1. **Creation** — tasks with no `blockedBy` start as `ready`; tasks with unresolved dependencies start as `blocked`. Task IDs are auto-assigned as `kb-1`, `kb-2`, etc. in creation order.
2. **Claiming** — `claim_tasks` moves `ready` tasks to `claimed` up to the `maxClaims` limit
3. **Advancing** — `advance_tasks` increments the phase index. Tasks stay `claimed` through phase transitions. If past the last phase, the task becomes `done`
4. **Rejecting** — `reject_tasks` resets the task to phase 0 and keeps it `claimed` (available at any phase, including the first)
5. **Unblocking** — when a task reaches `done`, all `blocked` tasks are re-evaluated; those whose `blockedBy` list is fully satisfied transition to `ready`

### Dependencies

- Dependencies are expressed via `blockedBy` — an array of task IDs or titles
- Titles are resolved to IDs at board creation time
- Circular dependencies are detected and rejected
- A task only becomes `ready` when **all** its blockers are `done`

## Usage Pattern

A typical agent workflow:

**1. Create the board** with tasks and their dependencies:

```json
{
  "tool": "create_kanban",
  "parameters": {
    "tasks": [
      { "title": "Design API schema", "description": "Define REST endpoints and data models...", "phases": ["implement", "review"] },
      { "title": "Implement endpoints", "description": "Build the route handlers...", "phases": ["test", "implement", "review"], "blockedBy": ["Design API schema"] },
      { "title": "Write integration tests", "description": "End-to-end tests for all routes...", "phases": ["implement"], "blockedBy": ["Implement endpoints"] }
    ]
  }
}
```

**2. Claim tasks** to pick up work:

```json
{
  "tool": "claim_tasks",
  "parameters": { "count": 2 }
}
```

Returns the full details (title, description, phase, profile, files) for claimed tasks.

**3. Delegate to subagents** using the profile and task details from the claim result.

**4. Review the output** — if the work is satisfactory, advance:

```json
{
  "tool": "advance_tasks",
  "parameters": { "ids": ["kb-1"] }
}
```

If the work needs rework, reject with a reason:

```json
{
  "tool": "reject_tasks",
  "parameters": { "ids": ["kb-1"], "reason": "Missing error handling for 429 responses" }
}
```

**5. Repeat** — call `claim_tasks` again to pick up newly ready tasks (including unblocked dependents). Continue until all tasks are `done`.

## State Persistence

Board state is event-sourced through tool result `details`. Every kanban tool returns a `KanbanDetails` envelope containing:

```typescript
{
  action: "create" | "list" | "claim" | "advance" | "reject";
  board: KanbanBoard | null;
  error?: string;
}
```

On `session_start` and `session_tree` events, the extension scans the session branch in reverse to find the most recent kanban tool result and reconstructs the board from it. This means:

- Board state survives agent restarts
- Branching and switching between session tree nodes preserves the correct board state for each branch
- No external state files are needed — everything is derived from the session history
