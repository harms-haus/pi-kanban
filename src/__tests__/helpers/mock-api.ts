/**
 * Mock Factories for Testing
 *
 * Provides factory functions to create mock Theme, ExtensionContext, and
 * ExtensionAPI instances with captured registrations for test inspection.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";

/** Generic handler type for the captured handlers map */
type AnyHandler = (event: any, ctx: any) => any;
import { vi } from "vitest";

// ── Mock Theme Factory ──

/**
 * Creates a mock Theme that returns its text arguments as-is (passthrough).
 *
 * All style methods (fg, bg, bold, dim, strikethrough, italic, underline, inverse)
 * return the text unchanged, allowing test assertions on the raw content.
 */
export function createMockTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    dim: vi.fn((text: string) => text),
    strikethrough: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
    getFgAnsi: vi.fn(() => ""),
    getBgAnsi: vi.fn(() => ""),
    getColorMode: vi.fn(() => "truecolor" as const),
    getThinkingBorderColor: vi.fn(() => (_text: string) => _text),
    getBashModeBorderColor: vi.fn(() => (_text: string) => _text),
  } as unknown as Theme;
}

// ── Mock Context Factory ──

/**
 * Creates a mock ExtensionContext with sensible defaults.
 *
 * @param overrides - Partial context fields to override the defaults
 * @returns A mock ExtensionContext shaped for testing
 */
export function createMockContext(overrides?: any): ExtensionContext {
  const defaultContext = {
    hasUI: false,
    cwd: "/test/workspace",
    ui: {
      setStatus: vi.fn(),
      setWidget: vi.fn(),
    } as unknown as ExtensionContext["ui"],
    sessionManager: {
      getBranch: vi.fn(() => []),
    } as unknown as ExtensionContext["sessionManager"],
    modelRegistry: {
      getApiKey: vi.fn(() => undefined),
      getAllProviders: vi.fn(() => []),
      getModelsForProvider: vi.fn(() => []),
    } as unknown as ExtensionContext["modelRegistry"],
    model: undefined,
    isIdle: vi.fn(() => true),
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: vi.fn(() => false),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(() => undefined),
    compact: vi.fn(),
    getSystemPrompt: vi.fn(() => ""),
  } as unknown as ExtensionContext;

  return {
    ...defaultContext,
    ...overrides,
  };
}

// ── Mock API Factory ──

/**
 * Creates a mock ExtensionAPI that captures registered tools, event handlers,
 * and message renderers for test inspection.
 *
 * Returned sub-objects:
 * - `capturedTools` — tools passed to `registerTool()`
 * - `capturedHandlers` — `Map<eventName, handler>` from `on()`
 * - `capturedRenderers` — `Map<customType, renderer>` from `registerMessageRenderer()`
 * - Individual vi.fn() mocks for each API method
 */
export function createMockAPI(): {
  api: ExtensionAPI;
  capturedTools: ToolDefinition[];
  capturedHandlers: Map<string, AnyHandler>;
  capturedRenderers: Map<string, MessageRenderer>;
  registerTool: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  registerMessageRenderer: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerShortcut: ReturnType<typeof vi.fn>;
  registerFlag: ReturnType<typeof vi.fn>;
  getFlag: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
  appendEntry: ReturnType<typeof vi.fn>;
  setSessionName: ReturnType<typeof vi.fn>;
  getSessionName: ReturnType<typeof vi.fn>;
  setLabel: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  getActiveTools: ReturnType<typeof vi.fn>;
  getAllTools: ReturnType<typeof vi.fn>;
  setActiveTools: ReturnType<typeof vi.fn>;
  getCommands: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  getThinkingLevel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
} {
  const capturedTools: ToolDefinition[] = [];
  const capturedHandlers = new Map<string, AnyHandler>();
  const capturedRenderers = new Map<string, MessageRenderer>();

  const registerTool = vi.fn((tool: ToolDefinition) => {
    capturedTools.push(tool);
  });

  const on = vi.fn((event: string, handler: AnyHandler) => {
    capturedHandlers.set(event, handler);
  });

  const registerMessageRenderer = vi.fn((customType: string, renderer: MessageRenderer) => {
    capturedRenderers.set(customType, renderer);
  });

  const registerCommand = vi.fn();
  const registerShortcut = vi.fn();
  const registerFlag = vi.fn();
  const getFlag = vi.fn(() => undefined);
  const sendMessage = vi.fn();
  const sendUserMessage = vi.fn();
  const appendEntry = vi.fn();
  const setSessionName = vi.fn();
  const getSessionName = vi.fn(() => undefined);
  const setLabel = vi.fn();
  const exec = vi.fn();
  const getActiveTools = vi.fn(() => []);
  const getAllTools = vi.fn(() => []);
  const setActiveTools = vi.fn();
  const getCommands = vi.fn(() => []);
  const setModel = vi.fn(async () => true);
  const getThinkingLevel = vi.fn(() => "off" as const);
  const setThinkingLevel = vi.fn();

  return {
    api: {
      registerTool,
      on,
      registerMessageRenderer,
      registerCommand,
      registerShortcut,
      registerFlag,
      getFlag,
      sendMessage,
      sendUserMessage,
      appendEntry,
      setSessionName,
      getSessionName,
      setLabel,
      exec,
      getActiveTools,
      getAllTools,
      setActiveTools,
      getCommands,
      setModel,
      getThinkingLevel,
      setThinkingLevel,
    } as unknown as ExtensionAPI,
    capturedTools,
    capturedHandlers,
    capturedRenderers,
    registerTool,
    on,
    registerMessageRenderer,
    registerCommand,
    registerShortcut,
    registerFlag,
    getFlag,
    sendMessage,
    sendUserMessage,
    appendEntry,
    setSessionName,
    getSessionName,
    setLabel,
    exec,
    getActiveTools,
    getAllTools,
    setActiveTools,
    getCommands,
    setModel,
    getThinkingLevel,
    setThinkingLevel,
  };
}
