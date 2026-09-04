import { describe, expect, it } from "vitest";

import {
  activeSuggestionId,
  pageSuggestionId,
  revealSuggestionScrollTop,
  suggestionAction,
  type SuggestionKeyboardEvent,
} from "./suggestion-navigation.js";

const key = (value: string, modifiers: Partial<SuggestionKeyboardEvent> = {}): SuggestionKeyboardEvent => ({
  key: value,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  ...modifiers,
});

describe("suggestion keyboard routing", () => {
  it("accepts plain Tab and Enter and leaves modified keys and composition to their owners", () => {
    expect(suggestionAction(key("Tab"))).toBe("accept");
    expect(suggestionAction(key("Enter"))).toBe("accept");
    expect(suggestionAction(key("Enter", { ctrlKey: true }))).toBeNull();
    expect(suggestionAction(key("ArrowDown", { shiftKey: true }))).toBeNull();
    expect(suggestionAction(key("Enter", { isComposing: true }))).toBeNull();
    expect(suggestionAction(key("Home"))).toBeNull();
    expect(suggestionAction(key("End"))).toBeNull();
  });

  it("lets registered chords override or disable defaults without swallowing other modifiers", () => {
    const bindings = [
      { key: "Enter", action: null },
      { key: "Enter", control: true, action: "accept" },
      { key: "Tab", action: "next" },
    ] as const;
    expect(suggestionAction(key("Enter"), bindings)).toBeNull();
    expect(suggestionAction(key("Enter", { ctrlKey: true }), bindings)).toBe("accept");
    expect(suggestionAction(key("Enter", { ctrlKey: true, shiftKey: true }), bindings)).toBeNull();
    expect(suggestionAction(key("Tab"), bindings)).toBe("next");
  });
});

describe("suggestion selection and viewport", () => {
  it("retains the selected identity across reordering and chooses a valid fallback after removal", () => {
    expect(activeSuggestionId([{ id: "c" }, { id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(activeSuggestionId([{ id: "c" }, { id: "a" }], "b")).toBe("c");
    expect(activeSuggestionId([], "b")).toBeNull();
  });

  it("moves by the visible height with variable-height rows and stops at the ends", () => {
    const rows = [
      { id: "a", top: 0, height: 30 },
      { id: "b", top: 30, height: 70 },
      { id: "c", top: 100, height: 30 },
      { id: "d", top: 130, height: 45 },
      { id: "e", top: 175, height: 30 },
    ];
    expect(pageSuggestionId(rows, "a", 100, 1)).toBe("c");
    expect(pageSuggestionId(rows, "d", 100, -1)).toBe("b");
    expect(pageSuggestionId(rows, "e", 100, 1)).toBe("e");
  });

  it("reveals only the clipped part and leaves already-visible rows alone", () => {
    expect(revealSuggestionScrollTop(0, 100, { id: "a", top: 70, height: 50 })).toBe(20);
    expect(revealSuggestionScrollTop(40, 100, { id: "b", top: 20, height: 30 })).toBe(20);
    expect(revealSuggestionScrollTop(40, 100, { id: "c", top: 70, height: 40 })).toBe(40);
    expect(revealSuggestionScrollTop(40, 100, { id: "d", top: 45, height: 180 })).toBe(45);
  });
});
