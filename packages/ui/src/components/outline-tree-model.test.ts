import { describe, expect, it } from "vitest";

import {
  computeIndent,
  computeOutdent,
  computeReorder,
  flattenOutline,
  type OutlineNode,
} from "./outline-tree-model.js";

const node = (id: string, children?: readonly OutlineNode<string>[]): OutlineNode<string> => ({
  children,
  id,
  value: id,
});

// projects[a[a1, a2], b], inbox
const sample = [node("projects", [node("a", [node("a1"), node("a2")]), node("b")]), node("inbox")];

describe("flattenOutline", () => {
  it("renders only rows whose every ancestor is expanded", () => {
    const collapsed = flattenOutline(sample, new Set());
    expect(collapsed.map((row) => row.key)).toEqual(["projects", "inbox"]);

    const open = flattenOutline(sample, new Set(["projects", "projects/a"]));
    expect(open.map((row) => row.key)).toEqual([
      "projects",
      "projects/a",
      "projects/a/a1",
      "projects/a/a2",
      "projects/b",
      "inbox",
    ]);
    expect(open.map((row) => row.depth)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it("keys repeated node ids by their path, so references stay distinct", () => {
    const shared = node("shared");
    const rows = flattenOutline([node("x", [shared]), node("y", [shared])], new Set(["x", "y"]));
    expect(rows.map((row) => row.key)).toEqual(["x", "x/shared", "y", "y/shared"]);
  });
});

describe("structure edits", () => {
  const rows = flattenOutline(sample, new Set(["projects", "projects/a"]));

  it("indent makes the row the last child of its previous sibling", () => {
    expect(computeIndent(rows, "projects/b")).toEqual({
      index: 2,
      sourceKey: "projects/b",
      targetParentKey: "projects/a",
    });
    expect(computeIndent(rows, "projects"), "the first sibling has nothing to indent under").toBeNull();
  });

  it("outdent moves the row right after its parent", () => {
    expect(computeOutdent(rows, "projects/a/a2")).toEqual({
      index: 1,
      sourceKey: "projects/a/a2",
      targetParentKey: "projects",
    });
    expect(computeOutdent(rows, "inbox"), "root rows cannot outdent").toBeNull();
  });

  it("reorder swaps within siblings and stops at the edges", () => {
    expect(computeReorder(rows, "projects/a/a2", -1)).toEqual({
      index: 0,
      sourceKey: "projects/a/a2",
      targetParentKey: "projects/a",
    });
    expect(computeReorder(rows, "projects/a/a1", -1)).toBeNull();
    expect(computeReorder(rows, "projects", 1)).toEqual({
      index: 1,
      sourceKey: "projects",
      targetParentKey: null,
    });
    expect(computeReorder(rows, "inbox", 1)).toBeNull();
  });
});
