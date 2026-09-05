import { describe, expect, it, vi } from "vitest";
import { outlineCommandDispatcher, outlineCommandForKey, type OutlineHostCommand } from "./outline-commands.js";

describe("host commands", () => {
  it("does not reserve product shortcuts and matches only explicitly registered chords", () => {
    const event = { key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    expect(outlineCommandForKey([], event)).toBeUndefined();
    const command: OutlineHostCommand = {
      id: "review",
      label: "Review",
      keyBindings: [{ key: "Enter", mod: true }],
      execute: () => undefined,
    };
    expect(outlineCommandForKey([command], event)).toBe(command);
    expect(outlineCommandForKey([command], { ...event, ctrlKey: false, metaKey: true })).toBe(command);
    expect(outlineCommandForKey([command], { ...event, shiftKey: true })).toBeUndefined();
  });

  it("dispatches a whole selection once with a checkpoint and the host's requested focus", () => {
    const execute = vi.fn(() => ({ key: "after", caret: 2 }));
    const checkpoint = vi.fn();
    const restore = vi.fn();
    const position = { key: "current", caret: 3, selectionEnd: 5 };
    const commands = outlineCommandDispatcher({
      commands: [{ id: "review", label: "Review", execute }],
      rows: [],
      selectedKeys: ["first", "second"],
      cursorKey: "current",
      getPosition: () => position,
      checkpoint,
      restore,
    });
    const content = [{ text: "Draft", type: "text" }] as const;
    expect(commands.execute("review", "completion", undefined, content)).toEqual({ key: "after", caret: 2 });
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      keys: ["first", "second"],
      position,
      content,
      source: "completion",
    });
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith(position);
    expect(restore).toHaveBeenCalledExactlyOnceWith({ key: "after", caret: 2 });
  });

  it("uses the clicked appearance for presentation actions and declines unavailable commands without side effects", () => {
    const execute = vi.fn();
    const checkpoint = vi.fn();
    const commands = outlineCommandDispatcher({
      commands: [{ id: "review", label: "Review", canExecute: (context) => context.keys.includes("allowed"), execute }],
      rows: [],
      selectedKeys: ["unrelated"],
      cursorKey: "current",
      getPosition: () => null,
      checkpoint,
      restore: vi.fn(),
    });
    expect(commands.execute("review", "keyboard")).toBe(false);
    expect(commands.execute("missing", "toolbar")).toBe(false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(commands.execute("review", "presentation", ["allowed"])).toBe(true);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      keys: ["allowed"],
      content: null,
      position: null,
      source: "presentation",
    });
  });
});
