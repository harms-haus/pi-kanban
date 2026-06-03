/**
 * Test Setup
 *
 * Mocks @earendil-works/pi-tui so tests can run without a TUI environment.
 */

import { vi } from "vitest";

class MockText {
  private _text: string;

  constructor(text: string = "", _paddingX: number = 0, _paddingY: number = 0) {
    this._text = text;
  }

  setText = vi.fn();
  setCustomBgFn = vi.fn();
  invalidate = vi.fn();

  render = vi.fn((_width: number): string[] => {
    if (this._text === "") return [];
    return this._text.split("\n");
  });
}

class MockContainer {
  render = vi.fn(() => "");
}

vi.mock("@earendil-works/pi-tui", () => ({
  Text: MockText,
  Container: MockContainer,
}));
