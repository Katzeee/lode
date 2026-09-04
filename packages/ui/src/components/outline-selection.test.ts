import { describe, expect, it } from "vitest";

import { flattenOutline, type OutlineItemViewModel } from "./outline-tree-view-model.js";
import {
  extendOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  toggleOutlineRow,
} from "./outline-selection.js";

const item = (id: string, children?: readonly OutlineItemViewModel[]): OutlineItemViewModel => ({
  accessibilityLabel: id,
  children,
  content: [{ text: id, type: "text" }],
  key: id,
});

const rows = flattenOutline([item("a", [item("a/a1"), item("a/a2")]), item("b"), item("c")], new Set(["a"]));

describe("outline selection", () => {
  it("extends and shrinks a contiguous range through visible rows", () => {
    const started = selectOutlineRow("a/a1");
    const extended = extendOutlineSelection(rows, started, "b");
    expect([...extended.keys]).toEqual(["a/a1", "a/a2", "b"]);
    expect([...extendOutlineSelection(rows, extended, "a/a2").keys]).toEqual(["a/a1", "a/a2"]);
  });

  it("supports discontiguous pointer toggles without losing the range anchor", () => {
    const started = selectOutlineRow("a");
    const added = toggleOutlineRow(started, "c");
    expect([...added.keys]).toEqual(["a", "c"]);
    expect(toggleOutlineRow(added, "c")).toEqual(started);
  });

  it("reduces a parent-and-descendant selection to movable roots", () => {
    expect(selectedOutlineRoots(rows, new Set(["a", "a/a1", "a/a2", "c"]))).toEqual(["a", "c"]);
  });
});
