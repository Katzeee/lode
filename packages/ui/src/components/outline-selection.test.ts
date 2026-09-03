import { describe, expect, it } from "vitest";

import { flattenOutline, type OutlineOccurrence } from "./outline-tree-model.js";
import {
  extendOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  toggleOutlineRow,
} from "./outline-selection.js";

const node = (id: string, children?: readonly OutlineOccurrence<string>[]): OutlineOccurrence<string> => ({
  children,
  nodeId: id,
  occurrenceId: id,
  value: id,
});

const rows = flattenOutline([node("a", [node("a1"), node("a2")]), node("b"), node("c")], new Set(["a"]));

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
