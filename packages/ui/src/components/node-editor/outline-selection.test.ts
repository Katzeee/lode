import { describe, expect, it } from "vitest";

import { flattenOutline, type OutlineItemViewModel } from "./outline-tree-view-model.js";
import {
  extendOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  toggleOutlineRow,
  outlineSelectionCoverage,
  normalizeOutlineSelection,
} from "./outline-selection.js";

const item = (id: string, children?: readonly OutlineItemViewModel[]): OutlineItemViewModel => ({
  accessibilityLabel: id,
  children,
  content: [{ text: id, type: "text" }],
  key: id,
  presentation: null,
});

const rows = flattenOutline([item("a", [item("a/a1"), item("a/a2")]), item("b"), item("c")], new Set(["a"]));

describe("outline selection", () => {
  it("covers every visible descendant of a selected parent without selecting its siblings", () => {
    const coverage = outlineSelectionCoverage(rows, new Set(["a"]));
    expect([...coverage]).toEqual([
      ["a", "a"],
      ["a/a1", "a"],
      ["a/a2", "a"],
    ]);
    expect(selectedOutlineRoots(rows, new Set(coverage.keys()))).toEqual(["a"]);
  });

  it("keeps subtree coverage coherent across collapse, expansion and redundant descendant selections", () => {
    const selection = selectOutlineRow("a");
    const collapsed = flattenOutline([item("a", [item("a/a1"), item("a/a2")]), item("b")], new Set());
    const normalized = normalizeOutlineSelection(collapsed, selection);
    expect([...outlineSelectionCoverage(collapsed, normalized.keys).keys()]).toEqual(["a"]);
    expect([...outlineSelectionCoverage(rows, normalized.keys).keys()]).toEqual(["a", "a/a1", "a/a2"]);
    expect([...outlineSelectionCoverage(rows, new Set(["a", "a/a1"])).values()]).toEqual(["a", "a", "a"]);
  });

  it("covers the subtree at either end of a range and releases it when the range shrinks", () => {
    const expanded = extendOutlineSelection(rows, selectOutlineRow("b"), "a");
    expect([...outlineSelectionCoverage(rows, expanded.keys).keys()]).toEqual(["a", "a/a1", "a/a2", "b"]);
    const shrunk = extendOutlineSelection(rows, expanded, "a/a2");
    expect([...outlineSelectionCoverage(rows, shrunk.keys).keys()]).toEqual(["a/a2", "b"]);
  });

  it("extends and shrinks a contiguous range through visible rows", () => {
    const started = selectOutlineRow("a/a1");
    const extended = extendOutlineSelection(rows, started, "b");
    expect([...extended.keys]).toEqual(["a/a1", "a/a2", "b"]);
    expect([...extendOutlineSelection(rows, extended, "a/a2").keys]).toEqual(["a/a1", "a/a2"]);
  });

  it("supports discontiguous pointer toggles without losing the range anchor", () => {
    const started = selectOutlineRow("a");
    const added = toggleOutlineRow(rows, started, "c");
    expect([...added.keys]).toEqual(["a", "c"]);
    expect(toggleOutlineRow(rows, added, "c")).toEqual(started);
  });

  it("does not create a latent child selection inside a selected parent", () => {
    const parent = selectOutlineRow("a");
    const childClick = toggleOutlineRow(rows, parent, "a/a1");
    expect(childClick).toEqual(parent);
    expect(toggleOutlineRow(rows, childClick, "a").keys.size).toBe(0);
    const addedParent = toggleOutlineRow(rows, selectOutlineRow("a/a1"), "a");
    expect([...addedParent.keys]).toEqual(["a"]);
  });

  it("reduces a parent-and-descendant selection to movable roots", () => {
    expect(selectedOutlineRoots(rows, new Set(["a", "a/a1", "a/a2", "c"]))).toEqual(["a", "c"]);
  });
});
