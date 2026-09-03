import { describe, expect, it } from "vitest";

import type { OutlineContent } from "./outline-content.js";
import {
  computeEditInsertion,
  computeEditMergeTarget,
  computeEditNavigation,
  computeIndent,
  computeOutdent,
  computeReorder,
  flattenOutline,
  resolveEditInsertion,
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

describe("editing targets", () => {
  const rows = flattenOutline(sample, new Set(["projects", "projects/a"]));
  const contentOf = (row: (typeof rows)[number]): OutlineContent => [{ text: row.node.value, type: "text" }];

  it("moves between visible rows and clamps the requested caret column", () => {
    expect(computeEditNavigation(rows, "projects/a/a1", 1, 8, contentOf)).toEqual({
      caret: 2,
      key: "projects/a/a2",
    });
    expect(computeEditNavigation(rows, "projects/a/a2", -1, "end", contentOf)).toEqual({
      caret: 2,
      key: "projects/a/a1",
    });
    expect(computeEditNavigation(rows, "projects", -1, 0, contentOf)).toBeNull();
  });

  it("places a merge caret at the join and predicts the merged input text", () => {
    expect(computeEditMergeTarget(rows, "projects/a/a2", [{ text: " remainder", type: "text" }], contentOf)).toEqual({
      caret: 2,
      content: [{ marks: undefined, text: "a1 remainder", type: "text" }],
      key: "projects/a/a1",
    });
    expect(computeEditMergeTarget(rows, "projects", [{ text: "orphan", type: "text" }], contentOf)).toBeNull();
  });

  it("waits for a newly inserted sibling instead of selecting the row it displaces", () => {
    const insertion = computeEditInsertion(rows, "projects/a/a1");
    expect(insertion).toEqual({
      displacedKey: "projects/a/a2",
      indexInParent: 1,
      parentKey: "projects/a",
    });
    expect(insertion === null ? null : resolveEditInsertion(rows, insertion)).toBeNull();

    const nextRows = flattenOutline(
      [node("projects", [node("a", [node("a1"), node("created"), node("a2")]), node("b")]), node("inbox")],
      new Set(["projects", "projects/a"]),
    );
    expect(insertion === null ? null : resolveEditInsertion(nextRows, insertion)).toEqual({
      caret: 0,
      key: "projects/a/created",
    });
  });

  it("finds a newly appended sibling when no row was previously displaced", () => {
    const insertion = computeEditInsertion(rows, "inbox");
    expect(insertion).toEqual({ displacedKey: null, indexInParent: 2, parentKey: null });

    const nextRows = flattenOutline([...sample, node("created")], new Set(["projects", "projects/a"]));
    expect(insertion === null ? null : resolveEditInsertion(nextRows, insertion)).toEqual({
      caret: 0,
      key: "created",
    });
  });
});
