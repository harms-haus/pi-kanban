import { describe, it, expect } from "vitest";
import { isValidTask, validatePhases, detectCycles, cloneBoard } from "../validation";
import { makeTask, makeBoard } from "./helpers/test-data";
import { MAX_TITLE_LENGTH } from "../types";

// ── isValidTask ──────────────────────────────────────────────────────

describe("isValidTask", () => {
  describe("valid inputs", () => {
    it("returns true for a valid complete Task object", () => {
      const task = makeTask();
      expect(isValidTask(task)).toBe(true);
    });

    it("returns true for task with all phases", () => {
      const task = makeTask({
        phases: ["test", "implement", "review"],
        currentPhaseIndex: 1,
      });
      expect(isValidTask(task)).toBe(true);
    });

    it("returns true for task with optional reason field", () => {
      const task = makeTask({ reason: "not good enough" });
      expect(isValidTask(task)).toBe(true);
    });

    it("returns true for task with populated files array", () => {
      const task = makeTask({ files: ["src/a.ts", "src/b.ts"] });
      expect(isValidTask(task)).toBe(true);
    });

    it("returns true for task with blockedBy entries", () => {
      const task = makeTask({ blockedBy: ["some-uuid-string"], status: "blocked" });
      expect(isValidTask(task)).toBe(true);
    });

    it("edge: currentPhaseIndex === -1 with status 'done' is valid", () => {
      const task = makeTask({ currentPhaseIndex: -1, status: "done" });
      expect(isValidTask(task)).toBe(true);
    });

    it("returns true for task with title at exactly MAX_TITLE_LENGTH", () => {
      const task = makeTask({ title: "a".repeat(MAX_TITLE_LENGTH) });
      expect(isValidTask(task)).toBe(true);
    });
  });

  describe("invalid inputs — non-object / missing fields", () => {
    it("returns false for null", () => {
      expect(isValidTask(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isValidTask(undefined)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isValidTask("not an object")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isValidTask(42)).toBe(false);
    });

    it("returns false for array", () => {
      expect(isValidTask([])).toBe(false);
    });

    it("returns false for boolean", () => {
      expect(isValidTask(true)).toBe(false);
    });
  });

  describe("invalid inputs — field-level checks", () => {
    it("returns false for missing id", () => {
      const task = makeTask();
      expect(isValidTask({ ...task, id: undefined })).toBe(false);
    });

    it("returns false for empty id", () => {
      expect(isValidTask(makeTask({ id: "" }))).toBe(false);
    });

    it("returns false for non-string id", () => {
      expect(isValidTask(makeTask({ id: 123 as unknown as string }))).toBe(false);
    });

    it("returns false for missing title", () => {
      const task = makeTask();
      expect(isValidTask({ ...task, title: undefined })).toBe(false);
    });

    it("returns false for empty title", () => {
      expect(isValidTask(makeTask({ title: "" }))).toBe(false);
    });

    it("returns false for title exceeding MAX_TITLE_LENGTH", () => {
      expect(isValidTask(makeTask({ title: "a".repeat(MAX_TITLE_LENGTH + 1) }))).toBe(false);
    });

    it("returns false for empty description", () => {
      expect(isValidTask(makeTask({ description: "" }))).toBe(false);
    });

    it("returns false for non-array files", () => {
      expect(isValidTask(makeTask({ files: "not-array" as unknown as string[] }))).toBe(false);
    });

    it("returns false for non-string file entry", () => {
      expect(isValidTask(makeTask({ files: [123 as unknown as string] }))).toBe(false);
    });

    it("returns false for empty phases", () => {
      expect(isValidTask(makeTask({ phases: [] as unknown as ["implement"] }))).toBe(false);
    });

    it("returns false for invalid phase name", () => {
      expect(isValidTask(makeTask({ phases: ["deploy"] as unknown as ["implement"] }))).toBe(false);
    });

    it("returns false for currentPhaseIndex out of range (too high)", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: 5 }))).toBe(false);
    });

    it("returns false for currentPhaseIndex < -1", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: -2 }))).toBe(false);
    });

    it("returns false for non-integer currentPhaseIndex", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: 0.5 }))).toBe(false);
    });

    it("returns false for invalid status", () => {
      expect(isValidTask(makeTask({ status: "unknown" as unknown as "ready" }))).toBe(false);
    });

    it("returns false for non-array blockedBy", () => {
      expect(isValidTask(makeTask({ blockedBy: "not-array" as unknown as string[] }))).toBe(false);
    });

    it("returns false for non-string blockedBy entry", () => {
      expect(isValidTask(makeTask({ blockedBy: [123 as unknown as string] }))).toBe(false);
    });

    it("returns false for missing profile", () => {
      const task = makeTask();
      expect(isValidTask({ ...task, profile: undefined })).toBe(false);
    });

    it("returns false for empty profile", () => {
      expect(isValidTask(makeTask({ profile: "" }))).toBe(false);
    });

    it("returns false for non-string reason", () => {
      expect(isValidTask(makeTask({ reason: 123 as unknown as string }))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("edge: currentPhaseIndex === -1 with status 'claimed' is invalid", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: -1, status: "claimed" }))).toBe(false);
    });

    it("edge: currentPhaseIndex === -1 with status 'ready' is invalid", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: -1, status: "ready" }))).toBe(false);
    });

    it("edge: currentPhaseIndex === -1 with status 'blocked' is invalid", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: -1, status: "blocked" }))).toBe(false);
    });

    it("returns false for non-string status", () => {
      expect(isValidTask(makeTask({ status: 42 as unknown as "ready" }))).toBe(false);
    });

    it("returns false for non-number currentPhaseIndex", () => {
      expect(isValidTask(makeTask({ currentPhaseIndex: "0" as unknown as number }))).toBe(false);
    });
  });
});

// ── validatePhases ───────────────────────────────────────────────────

describe("validatePhases", () => {
  describe("valid inputs", () => {
    it("valid: ['implement']", () => {
      const result = validatePhases(["implement"]);
      expect(result).toEqual({ valid: true, phases: ["implement"] });
    });

    it("valid: ['test', 'implement']", () => {
      const result = validatePhases(["test", "implement"]);
      expect(result).toEqual({ valid: true, phases: ["test", "implement"] });
    });

    it("valid: ['implement', 'review']", () => {
      const result = validatePhases(["implement", "review"]);
      expect(result).toEqual({ valid: true, phases: ["implement", "review"] });
    });

    it("valid: ['test', 'implement', 'review']", () => {
      const result = validatePhases(["test", "implement", "review"]);
      expect(result).toEqual({ valid: true, phases: ["test", "implement", "review"] });
    });

    it("valid: ['review']", () => {
      const result = validatePhases(["review"]);
      expect(result).toEqual({ valid: true, phases: ["review"] });
    });

    it("valid: ['test']", () => {
      const result = validatePhases(["test"]);
      expect(result).toEqual({ valid: true, phases: ["test"] });
    });
  });

  describe("invalid inputs", () => {
    it("invalid: empty array", () => {
      const result = validatePhases([]);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
      if (!result.valid) {
        expect(result.error).toContain("non-empty");
      }
    });

    it("invalid: non-array", () => {
      const result = validatePhases("not-array");
      expect(result).toEqual({ valid: false, error: expect.any(String) });
    });

    it("invalid: non-array (null)", () => {
      const result = validatePhases(null);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
    });

    it("invalid: unknown phase ('deploy')", () => {
      const result = validatePhases(["deploy"]);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
      if (!result.valid) {
        expect(result.error).toContain("invalid phase");
      }
    });

    it("invalid: out of order (['implement', 'test'])", () => {
      const result = validatePhases(["implement", "test"]);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
      if (!result.valid) {
        expect(result.error).toContain("out of order");
      }
    });

    it("invalid: out of order (['review', 'test'])", () => {
      const result = validatePhases(["review", "test"]);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
      if (!result.valid) {
        expect(result.error).toContain("out of order");
      }
    });

    it("invalid: duplicate phase", () => {
      const result = validatePhases(["implement", "implement"]);
      expect(result).toEqual({ valid: false, error: expect.any(String) });
    });
  });
});

// ── detectCycles ─────────────────────────────────────────────────────

describe("detectCycles", () => {
  it("no cycle → returns null", () => {
    const tasks = [
      { id: "A", blockedBy: [] },
      { id: "B", blockedBy: ["A"] },
      { id: "C", blockedBy: ["B"] },
    ];
    expect(detectCycles(tasks)).toBeNull();
  });

  it("direct cycle (A→B→A) → returns error string", () => {
    const tasks = [
      { id: "A", blockedBy: ["B"] },
      { id: "B", blockedBy: ["A"] },
    ];
    const result = detectCycles(tasks);
    expect(result).not.toBeNull();
    expect(result).toContain("cycle detected");
  });

  it("indirect cycle (A→B→C→A) → returns error string", () => {
    const tasks = [
      { id: "A", blockedBy: ["C"] },
      { id: "B", blockedBy: ["A"] },
      { id: "C", blockedBy: ["B"] },
    ];
    const result = detectCycles(tasks);
    expect(result).not.toBeNull();
    expect(result).toContain("cycle detected");
  });

  it("self-reference (A→A) → returns error string", () => {
    const tasks = [{ id: "A", blockedBy: ["A"] }];
    const result = detectCycles(tasks);
    expect(result).not.toBeNull();
    expect(result).toContain("cycle detected");
  });

  it("no cycle with complex DAG → returns null", () => {
    const tasks = [
      { id: "A", blockedBy: [] },
      { id: "B", blockedBy: [] },
      { id: "C", blockedBy: ["A", "B"] },
      { id: "D", blockedBy: ["A"] },
      { id: "E", blockedBy: ["C", "D"] },
    ];
    expect(detectCycles(tasks)).toBeNull();
  });

  it("returns null for empty task list", () => {
    expect(detectCycles([])).toBeNull();
  });

  it("returns null for single task with no dependencies", () => {
    expect(detectCycles([{ id: "A", blockedBy: [] }])).toBeNull();
  });

  it("ignores blockedBy references to unknown IDs (no cycle)", () => {
    const tasks = [
      { id: "A", blockedBy: ["unknown-id"] },
      { id: "B", blockedBy: ["A"] },
    ];
    expect(detectCycles(tasks)).toBeNull();
  });
});

// ── cloneBoard ───────────────────────────────────────────────────────

describe("cloneBoard", () => {
  it("returns a deep copy — modifying clone doesn't affect original", () => {
    const original = makeBoard([
      makeTask({ id: "task-1", title: "Original title" }),
      makeTask({ id: "task-2", blockedBy: ["task-1"] }),
    ]);

    const cloned = cloneBoard(original);

    // Different reference
    expect(cloned).not.toBe(original);
    expect(cloned.tasks).not.toBe(original.tasks);
    expect(cloned.tasks[0]).not.toBe(original.tasks[0]);

    // Equal values
    expect(cloned).toEqual(original);

    // Modify clone — original unaffected
    cloned.tasks[0]!.title = "Modified";
    cloned.tasks.push(makeTask({ id: "task-3" }));
    cloned.profileMap["test"] = "custom-profile";
    cloned.maxClaims = 10;

    expect(original.tasks[0]!.title).toBe("Original title");
    expect(original.tasks).toHaveLength(2);
    expect(original.profileMap["test"]).toBe("task-worker-tests");
    expect(original.maxClaims).toBe(4);
  });

  it("preserves all fields", () => {
    const original = makeBoard([makeTask({ id: "task-1" })], {
      profileMap: { test: "custom" },
      maxClaims: 7,
      createdAt: 1234567890,
    });

    const cloned = cloneBoard(original);
    expect(cloned.tasks).toEqual(original.tasks);
    expect(cloned.profileMap).toEqual({ test: "custom" });
    expect(cloned.maxClaims).toBe(7);
    expect(cloned.createdAt).toBe(1234567890);
  });

  it("handles empty board", () => {
    const original = makeBoard([]);
    const cloned = cloneBoard(original);
    expect(cloned).not.toBe(original);
    expect(cloned).toEqual(original);
  });
});
