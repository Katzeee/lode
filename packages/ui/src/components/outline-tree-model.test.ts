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
  type OutlineOccurrence,
} from "./outline-tree-model.js";

const node = (id: string, children?: readonly OutlineOccurrence<string>[]): OutlineOccurrence<string> => ({
  children,
  nodeId: id,
  occurrenceId: id,
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

  it("keys occurrences independently while an expanded Reference unfolds the target's children", () => {
    const child = node("shared-child");
    const original = { ...node("shared-original", [child]), nodeId: "shared" };
    const reference = {
      ...node("shared-reference", [child]),
      appearance: "reference" as const,
      nodeId: "shared",
    };
    const rows = flattenOutline(
      [node("x", [original]), node("y", [reference])],
      new Set(["x", "x/shared-original", "y", "y/shared-reference"]),
    );
    expect(rows.map((row) => row.key)).toEqual([
      "x",
      "x/shared-original",
      "x/shared-original/shared-child",
      "y",
      "y/shared-reference",
      "y/shared-reference/shared-child",
    ]);
    expect(rows[1]?.occurrence.nodeId).toBe(rows[4]?.occurrence.nodeId);
    expect(rows[4]?.occurrence.appearance).toBe("reference");
    expect(rows[5]?.occurrence.appearance).toBeUndefined();
  });

  it("allows an empty Node to enter expanded state without inventing a child model", () => {
    const [row] = flattenOutline([node("empty")], new Set(["empty"]));
    expect(row).toMatchObject({ expandable: true, expanded: true, hasChildren: false });
  });
});

describe("structure edits", () => {
  const rows = flattenOutline(sample, new Set(["projects", "projects/a"]));

  it("indent makes the row the last child of its previous sibling", () => {
    expect(computeIndent(rows, ["projects/b"])).toEqual({
      index: 2,
      sourceKeys: ["projects/b"],
      targetParentKey: "projects/a",
    });
    expect(computeIndent(rows, ["projects"]), "the first sibling has nothing to indent under").toBeNull();
  });

  it("outdent moves the row right after its parent", () => {
    expect(computeOutdent(rows, ["projects/a/a2"])).toEqual({
      index: 1,
      sourceKeys: ["projects/a/a2"],
      targetParentKey: "projects",
    });
    expect(computeOutdent(rows, ["inbox"]), "root rows cannot outdent").toBeNull();
  });

  it("reorder swaps within siblings and stops at the edges", () => {
    expect(computeReorder(rows, ["projects/a/a2"], -1)).toEqual({
      index: 0,
      sourceKeys: ["projects/a/a2"],
      targetParentKey: "projects/a",
    });
    expect(computeReorder(rows, ["projects/a/a1"], -1)).toBeNull();
    expect(computeReorder(rows, ["projects"], 1)).toEqual({
      index: 1,
      sourceKeys: ["projects"],
      targetParentKey: null,
    });
    expect(computeReorder(rows, ["inbox"], 1)).toBeNull();
  });

  it("moves a contiguous multi-selection as one ordered sibling run", () => {
    expect(computeReorder(rows, ["projects/a/a1", "projects/a/a2"], 1)).toBeNull();
    expect(computeOutdent(rows, ["projects/a/a1", "projects/a/a2"])).toEqual({
      index: 1,
      sourceKeys: ["projects/a/a1", "projects/a/a2"],
      targetParentKey: "projects",
    });
  });
});

describe("editing targets", () => {
  const rows = flattenOutline(sample, new Set(["projects", "projects/a"]));
  const contentOf = (row: (typeof rows)[number]): OutlineContent => [{ text: row.occurrence.value, type: "text" }];

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
