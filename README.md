# pi-kanban

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.3.0-blue)

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

### `write_kanban`

Creates or modifies a kanban board. Supports four modes: `replace`, `append`, `edit`, and `delete`. Only one board can exist at a time.

**Common parameter — `mode`** (required): one of `replace`, `append`, `edit`, `delete`.

---

#### Mode: `replace`

Creates a new board. Errors if a board already exists. Task IDs start at `kb-1`.

**Parameters:**

| Parameter    | Type                     | Required | Description                              |
| ------------ | ------------------------ | -------- | ---------------------------------------- |
| `mode`       | `"replace"`              | Yes      | Create a new board                       |
| `tasks`      | `TaskInput[]`            | Yes      | Array of tasks (1–100 items)             |
| `profileMap` | `Record<string, string>` | No       | Override default phase → profile mapping |

**Example:**

```json
{
  "tool": "write_kanban",
  "parameters": {
    "mode": "replace",
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

---

#### Mode: `append`

Adds tasks to an existing board. Requires a board to exist. New task IDs continue from the board's `nextId` counter (e.g. if the board has `kb-1` through `kb-3`, appended tasks start at `kb-4`). New tasks can reference existing tasks in their `blockedBy` field. The board's total task count cannot exceed 100.

**Parameters:**

| Parameter    | Type                     | Required | Description                              |
| ------------ | ------------------------ | -------- | ---------------------------------------- |
| `mode`       | `"append"`               | Yes      | Add tasks to an existing board           |
| `tasks`      | `TaskInput[]`            | Yes      | Array of tasks to add (1–100 items)      |
| `profileMap` | `Record<string, string>` | No       | Merged on top of existing profileMap     |

**Example:**

```json
{
  "tool": "write_kanban",
  "parameters": {
    "mode": "append",
    "tasks": [
      {
        "title": "Add logging middleware",
        "description": "Implement request/response logging for all endpoints.",
        "files": ["src/middleware/"],
        "phases": ["implement", "review"],
        "blockedBy": ["kb-1"]
      }
    ]
  }
}
```

---

#### Mode: `edit`

Modifies existing tasks. Only the fields specified in each edit's `set` object are changed — omitted fields remain untouched. All edits are validated atomically: if any edit references a missing task ID or contains invalid data, no edits are applied. If multiple edits reference the same task ID, only the last entry per ID is applied. If `blockedBy` or `phases` changes, statuses are recomputed and a cycle check is performed (edits are rolled back on failure).

**Parameters:**

| Parameter | Type                  | Required | Description                          |
| --------- | --------------------- | -------- | ------------------------------------ |
| `mode`    | `"edit"`              | Yes      | Modify existing tasks                |
| `edits`   | `EditEntry[]`         | Yes      | Array of edits (1–50 items)          |

**EditEntry:**

| Field  | Type       | Required | Description                                                      |
| ------ | ---------- | -------- | ---------------------------------------------------------------- |
| `id`   | `string`   | Yes      | Task ID to edit (e.g. `kb-3`)                                    |
| `set`  | `object`   | Yes      | Fields to change. Only provided keys are updated.                |

The `set` object accepts these optional fields (`additionalProperties: false`):

| `set` field   | Type       | Description                                                                 |
| ------------- | ---------- | --------------------------------------------------------------------------- |
| `title`       | `string`   | New title (max 100 chars)                                                   |
| `description` | `string`   | New description (max 10,000 chars)                                          |
| `files`       | `string[]` | Replace file paths (max 50 items, 500 chars each)                           |
| `phases`      | `string[]` | Replace phases (validated as subsequence of canonical order)                |
| `blockedBy`   | `string[]` | Replace dependencies (max 20 items; triggers cycle check)                   |

If `phases` is shortened such that `currentPhaseIndex` exceeds the new length, it is clamped to the last valid phase index.

**Example:**

```json
{
  "tool": "write_kanban",
  "parameters": {
    "mode": "edit",
    "edits": [
      {
        "id": "kb-2",
        "set": {
          "description": "Updated: also cover PATCH endpoints for partial updates.",
          "blockedBy": ["kb-1"]
        }
      },
      {
        "id": "kb-3",
        "set": {
          "phases": ["test", "implement", "review"]
        }
      }
    ]
  }
}
```

---

#### Mode: `delete`

Removes tasks by ID. Automatically cleans up `blockedBy` references on remaining tasks that pointed to deleted tasks. All IDs are validated atomically — if any ID is not found, no tasks are deleted. Deleted IDs are **never reused**; the board's `nextId` counter only increases.

**Parameters:**

| Parameter | Type       | Required | Description                       |
| --------- | ---------- | -------- | --------------------------------- |
| `mode`    | `"delete"` | Yes      | Remove tasks                      |
| `ids`     | `string[]` | Yes      | Task IDs to delete (1–50 items)   |

**Example:**

```json
{
  "tool": "write_kanban",
  "parameters": {
    "mode": "delete",
    "ids": ["kb-2", "kb-5"]
  }
}
```

---

#### TaskInput (for `replace` and `append` modes)

| Field         | Type       | Required | Description                                                                                                |
| ------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `title`       | `string`   | Yes      | Short title (max 100 chars)                                                                                |
| `description` | `string`   | Yes      | Detailed description for subagents (max 10,000 chars)                                                      |
| `files`       | `string[]` | No       | Relevant file paths (max 50 items, 500 chars each)                                                         |
| `phases`      | `string[]` | No       | Ordered subset of `test`, `implement`, `review`. Default: `["implement"]`                                  |
| `blockedBy`   | `string[]` | No       | Task IDs or titles this task depends on (max 20 items). Titles are resolved to IDs when the board is created or tasks are appended. |

#### Task ID assignment

Task IDs are auto-assigned in `kb-N` sequential format:
- In `replace` mode, IDs start at `kb-1`
- In `append` mode, IDs continue from the board's `nextId` counter
- Deleted IDs are never reused — the counter only increases
- The `blockedBy` field accepts either IDs (e.g. `kb-3`) or titles (e.g. `"Set up database schema"`). Titles are resolved to IDs at board creation or append time.

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

Returns the full board text or `"No board exists. Use write_kanban to create one."` if no board is active.

**Output format:**

Each line follows the pattern `{phase_icon} [{id}] {title} → {deps}`:

| Element        | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| Phase icon     | `🧪` test, `⚙️` implement, `👁` review, `✅` done                      |
| Dependencies   | `→` followed by comma-separated blocker task IDs (omitted if none)      |

**Example output:**

```
📋 Kanban Board — 3 total, 1 claimed, 1 ready, 0 blocked, 1 done

── CLAIMED ──
⚙️ [kb-2] Implement endpoints → kb-1

── READY ──
🧪 [kb-3] Write integration tests → kb-2

── DONE ──
✅ [kb-1] Design API schema
```

### `claim_tasks`

Claims up to `count` new ready tasks from the board, respecting the `maxClaims` limit. Always returns all currently outstanding (already claimed) tasks alongside any newly claimed ones.

**Parameters:**

| Parameter | Type      | Required | Description                          |
| --------- | --------- | -------- | ------------------------------------ |
| `count`   | `integer` | Yes      | Number of new tasks to claim (min 1) |

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

| Parameter | Type       | Required | Description                      |
| --------- | ---------- | -------- | -------------------------------- |
| `ids`     | `string[]` | Yes      | Task IDs to advance (1–50 items) |

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
- If `currentPhaseIndex >= phases.length` → task is marked `done` and its rejection reason (if any) is cleared
- Otherwise → task stays `claimed` at the next phase (no need to re-claim)
- For done tasks, all dependents are re-evaluated and unblocked if all their dependencies are satisfied

### `reject_tasks`

Rejects one or more claimed tasks, resetting them to phase 0 while keeping them claimed. Optionally records a rejection reason. Tasks at any phase — including the first phase — can be rejected. First-phase rejection records the reason without changing the phase index.

**Parameters:**

| Parameter | Type       | Required | Description                     |
| --------- | ---------- | -------- | ------------------------------- |
| `ids`     | `string[]` | Yes      | Task IDs to reject (1–50 items) |
| `reason`  | `string`   | No       | Reason for rejection            |

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

| Setting      | Type                     | Default                                                                            | Description                                                                   |
| ------------ | ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `profileMap` | `Record<string, string>` | `{ test: "task-worker-tests", implement: "task-worker", review: "task-reviewer" }` | Maps phase names to subagent profile names. Always merged on top of defaults. |
| `maxClaims`  | `integer`                | `4`                                                                                | Maximum concurrent claimed tasks. Clamped to 1–10.                            |

The `profileMap` can also be overridden per-board via the `profileMap` parameter in `write_kanban`. Merge order is: defaults → global settings → project settings → per-board parameter.

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

1. **Creation** — `write_kanban` (mode `replace`) creates the board. Tasks with no `blockedBy` start as `ready`; tasks with unresolved dependencies start as `blocked`. Task IDs are auto-assigned as `kb-1`, `kb-2`, etc. in creation order. Additional tasks can be added with mode `append`, edited with mode `edit`, or removed with mode `delete`.
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
  "tool": "write_kanban",
  "parameters": {
    "mode": "replace",
    "tasks": [
      {
        "title": "Design API schema",
        "description": "Define REST endpoints and data models...",
        "phases": ["implement", "review"]
      },
      {
        "title": "Implement endpoints",
        "description": "Build the route handlers...",
        "phases": ["test", "implement", "review"],
        "blockedBy": ["Design API schema"]
      },
      {
        "title": "Write integration tests",
        "description": "End-to-end tests for all routes...",
        "phases": ["implement"],
        "blockedBy": ["Implement endpoints"]
      }
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
  action: "write" | "list" | "claim" | "advance" | "reject";
  board: KanbanBoard | null;
  error?: string;
}
```

On `session_start` and `session_tree` events, the extension scans the session branch in reverse to find the most recent kanban tool result and reconstructs the board from it. This means:

- Board state survives agent restarts
- Branching and switching between session tree nodes preserves the correct board state for each branch
- No external state files are needed — everything is derived from the session history

## Powerline UI Integration

The extension publishes real-time board status to the TUI after every board mutation (write, claim, advance, reject). This status is consumed by **pi-powerline** to display an at-a-glance view of the board above the composer.

The powerline display shows:

- **Claimed tasks** with their current phase icon, listed individually
- **Summary line** in the format `[done/total] N claimed, N ready, N blocked`, positioned closest to the composer

No configuration is required — the integration activates automatically when both pi-kanban and pi-powerline are installed.

**Published payload** (`ctx.ui.setStatus("kanban", ...)`):

```json
{
  "total": 5,
  "claimed": 2,
  "ready": 1,
  "blocked": 1,
  "done": 1,
  "claimedTasks": [
    { "id": "kb-2", "title": "Implement endpoints", "phase": "implement" },
    { "id": "kb-3", "title": "Write tests", "phase": "test" }
  ]
}
```
