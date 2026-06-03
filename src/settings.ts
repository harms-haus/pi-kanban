/**
 * Kanban Settings
 *
 * Reads profileMap and maxClaims from global and project-local
 * settings files. Project-local settings override global settings.
 *
 * Settings file locations:
 *   Global:   ~/.pi/agent/settings.json
 *   Project:  .pi/settings.json
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_PROFILE_MAP, DEFAULT_MAX_CLAIMS, type Phase } from "./types";

// ── Settings Types ───────────────────────────────────────────────────

export interface KanbanSettings {
  profileMap: Record<string, string>;
  maxClaims: number;
}

// ── Path Helpers ─────────────────────────────────────────────────────

/** Returns the base agent directory (PI_AGENT_DIR or ~/.pi/agent) */
export function getAgentDir(): string {
  return process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/** Returns the path to the global settings file */
export function getGlobalSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

/** Returns the path to the project-local settings file */
export function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

// ── Private Helpers ──────────────────────────────────────────────────

/** Reads and parses a JSON settings file; returns {} on missing file or parse error */
async function readSettingsFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Type guard: checks value is a non-null object with all string values */
function isValidProfileMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== "string") return false;
  }
  return true;
}

/** Type guard: checks value is a finite number */
function isValidMaxClaims(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load kanban settings, merging global and project-local (if cwd provided).
 *
 * Project-local settings override global. The profileMap is always built
 * on top of DEFAULT_PROFILE_MAP so defaults are never lost.
 * maxClaims is clamped to [1, 10].
 */
export async function loadSettings(cwd?: string): Promise<KanbanSettings> {
  // Read global settings
  const global = await readSettingsFile(getGlobalSettingsPath());
  const globalKanban = global.kanban as Record<string, unknown> | undefined;

  let profileMap: Record<string, string> | undefined;
  let maxClaims: number | undefined;

  if (globalKanban && isValidProfileMap(globalKanban.profileMap)) {
    profileMap = globalKanban.profileMap;
  }
  if (globalKanban && isValidMaxClaims(globalKanban.maxClaims)) {
    maxClaims = globalKanban.maxClaims;
  }

  // Read project settings (override global)
  if (cwd) {
    const project = await readSettingsFile(getProjectSettingsPath(cwd));
    const projectKanban = project.kanban as Record<string, unknown> | undefined;

    if (projectKanban && isValidProfileMap(projectKanban.profileMap)) {
      profileMap = projectKanban.profileMap;
    }
    if (projectKanban && isValidMaxClaims(projectKanban.maxClaims)) {
      maxClaims = projectKanban.maxClaims;
    }
  }

  // Build final profileMap on top of defaults
  const finalProfileMap: Record<string, string> = {
    ...DEFAULT_PROFILE_MAP,
    ...(profileMap ?? {}),
  };

  // Clamp maxClaims to [1, 10]
  const rawMax = maxClaims ?? DEFAULT_MAX_CLAIMS;
  const finalMaxClaims = Math.max(1, Math.min(10, rawMax));

  return { profileMap: finalProfileMap, maxClaims: finalMaxClaims };
}

/**
 * Resolve a subagent profile name for the given phase.
 * Looks up phase in profileMap, falls back to DEFAULT_PROFILE_MAP, then to "task-worker".
 */
export function resolveProfile(phase: Phase, profileMap: Record<string, string>): string {
  return profileMap[phase] ?? DEFAULT_PROFILE_MAP[phase] ?? "task-worker";
}
