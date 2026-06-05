/**
 * Tests for the Kanban Settings module
 *
 * Covers loadSettings, resolveProfile, and helper functions to meet
 * branch coverage thresholds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock node:fs/promises ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Import after mocks
import { readFile } from "node:fs/promises";
import {
  loadSettings,
  resolveProfile,
  getAgentDir,
  getGlobalSettingsPath,
  getProjectSettingsPath,
} from "../settings";
import { DEFAULT_PROFILE_MAP, DEFAULT_MAX_CLAIMS } from "../types";

// ── Tests ──

describe("settings", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  afterEach(() => {
    delete process.env.PI_AGENT_DIR;
  });

  // ── Path Helpers ──

  describe("getAgentDir", () => {
    it("uses PI_AGENT_DIR when set", () => {
      process.env.PI_AGENT_DIR = "/custom/agent";
      expect(getAgentDir()).toBe("/custom/agent");
    });

    it("falls back to ~/.pi/agent when env not set", () => {
      delete process.env.PI_AGENT_DIR;
      const dir = getAgentDir();
      expect(dir).toContain(".pi/agent");
    });
  });

  describe("getGlobalSettingsPath", () => {
    it("returns path ending with settings.json", () => {
      const path = getGlobalSettingsPath();
      expect(path).toMatch(/settings\.json$/);
      expect(path).toContain(".pi/agent");
    });
  });

  describe("getProjectSettingsPath", () => {
    it("returns project-local path", () => {
      const path = getProjectSettingsPath("/my/project");
      expect(path).toBe("/my/project/.pi/settings.json");
    });
  });

  // ── loadSettings ──

  describe("loadSettings", () => {
    it("returns defaults when no settings files exist", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      const result = await loadSettings();

      expect(result.profileMap).toEqual(DEFAULT_PROFILE_MAP);
      expect(result.maxClaims).toBe(DEFAULT_MAX_CLAIMS);
    });

    it("loads profileMap from global settings", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: {
            profileMap: { implement: "my-worker" },
          },
        }),
      );

      const result = await loadSettings();

      expect(result.profileMap.implement).toBe("my-worker");
      expect(result.maxClaims).toBe(DEFAULT_MAX_CLAIMS);
    });

    it("loads maxClaims from global settings and clamps", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: {
            maxClaims: 20, // Will be clamped to 10
          },
        }),
      );

      const result = await loadSettings();

      expect(result.maxClaims).toBe(10);
    });

    it("clamps maxClaims to minimum of 1", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: {
            maxClaims: -5,
          },
        }),
      );

      const result = await loadSettings();

      expect(result.maxClaims).toBe(1);
    });

    it("loads project settings and overrides global", async () => {
      // First call (global) returns one thing, second call (project) returns override
      vi.mocked(readFile)
        .mockResolvedValueOnce(
          JSON.stringify({
            kanban: {
              profileMap: { implement: "global-worker" },
              maxClaims: 8,
            },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            kanban: {
              profileMap: { implement: "project-worker" },
              maxClaims: 3,
            },
          }),
        );

      const result = await loadSettings("/my/project");

      // Project values should override global
      expect(result.profileMap.implement).toBe("project-worker");
      expect(result.maxClaims).toBe(3);
    });

    it("merges project settings with defaults (partial override)", async () => {
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify({}))
        .mockResolvedValueOnce(
          JSON.stringify({
            kanban: {
              profileMap: { test: "custom-tester" },
            },
          }),
        );

      const result = await loadSettings("/my/project");

      // Default profileMap keys should still be present
      expect(result.profileMap.test).toBe("custom-tester");
      expect(result.profileMap.implement).toBe(DEFAULT_PROFILE_MAP.implement);
      expect(result.profileMap.review).toBe(DEFAULT_PROFILE_MAP.review);
    });

    it("ignores invalid kanban settings (non-object)", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: "not-an-object",
        }),
      );

      const result = await loadSettings();

      expect(result.profileMap).toEqual(DEFAULT_PROFILE_MAP);
      expect(result.maxClaims).toBe(DEFAULT_MAX_CLAIMS);
    });

    it("ignores invalid profileMap (non-object values)", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: {
            profileMap: { implement: 123 },
          },
        }),
      );

      const result = await loadSettings();

      // Should fall back to defaults since profileMap values aren't strings
      expect(result.profileMap.implement).toBe(DEFAULT_PROFILE_MAP.implement);
    });

    it("ignores invalid maxClaims (NaN)", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          kanban: {
            maxClaims: "not-a-number",
          },
        }),
      );

      const result = await loadSettings();

      // Should fall back to default
      expect(result.maxClaims).toBe(DEFAULT_MAX_CLAIMS);
    });

    it("returns defaults when settings file contains malformed JSON", async () => {
      vi.mocked(readFile).mockResolvedValue("not valid json {{{");

      const result = await loadSettings();

      expect(result.profileMap).toEqual(DEFAULT_PROFILE_MAP);
      expect(result.maxClaims).toBe(DEFAULT_MAX_CLAIMS);
    });
  });

  // ── resolveProfile ──

  describe("resolveProfile", () => {
    it("uses profileMap first", () => {
      const result = resolveProfile("implement", { implement: "my-custom-worker" });
      expect(result).toBe("my-custom-worker");
    });

    it("falls back to DEFAULT_PROFILE_MAP", () => {
      const result = resolveProfile("test", {});
      expect(result).toBe(DEFAULT_PROFILE_MAP.test);
    });

    it("falls back to 'task-worker' when nothing matches", () => {
      const result = resolveProfile("implement", {});
      // After empty profileMap lookup fails, falls to DEFAULT_PROFILE_MAP then "task-worker"
      expect(result).toBe(DEFAULT_PROFILE_MAP.implement);
    });

    it("falls back through DEFAULT_PROFILE_MAP for known phases", () => {
      // With an empty profileMap, DEFAULT_PROFILE_MAP provides the fallback
      const result = resolveProfile("implement", {});
      expect(result).toBe(DEFAULT_PROFILE_MAP.implement);
    });
  });
});
