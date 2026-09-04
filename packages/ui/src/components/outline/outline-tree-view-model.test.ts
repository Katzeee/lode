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
  type OutlineItemViewModel,
} from "./outline-tree-view-model.js";

const item = (key: string, label: string, children?: readonly OutlineItemViewModel[]): OutlineItemViewModel => ({
  accessibilityLabel: label,
  children,
  content: label.length === 0 ? [] : [{ text: label, type: "text" }],
  key,
  presentation: null,
});

const keys = {
  alpha: "opaque/alpha",
  alphaOne: "leaf one",
  alphaTwo: "leaf:two",
  beta: "opaque beta",
  inbox: "inbox#appearance",
  projects: "appearance projects",
} as const;

const sample = [
  item(keys.projects, "projects", [
    item(keys.alpha, "a", [item(keys.alphaOne, "a1"), item(keys.alphaTwo, "a2")]),
    item(keys.beta, "b"),
  ]),
  item(keys.inbox, "inbox"),
];
const expanded = new Set([keys.projects, keys.alpha]);

describe("flattenOutline", () => {
  it("renders only items whose every ancestor is expanded and preserves opaque keys", () => {
    expect(flattenOutline(sample, new Set()).map((row) => row.key)).toEqual([keys.projects, keys.inbox]);

    const open = flattenOutline(sample, expanded);
    expect(open.map((row) => row.key)).toEqual([
      keys.projects,
      keys.alpha,
      keys.alphaOne,
      keys.alphaTwo,
      keys.beta,
      keys.inbox,
    ]);
    expect(open.map((row) => row.depth)).toEqual([0, 1, 2, 2, 1, 0]);
    expect(open[1]?.parentKey).toBe(keys.projects);
    expect(open[2]?.parentKey).toBe(keys.alpha);
  });

  it("allows an empty item to enter expanded state without inventing a child Model", () => {
    const [row] = flattenOutline([item("empty key", "empty")], new Set(["empty key"]));
    expect(row).toMatchObject({ expandable: true, expanded: true, hasChildren: false });
  });
});

describe("structure intents", () => {
  const rows = flattenOutline(sample, expanded);

  it("indents the item beneath its previous sibling", () => {
    expect(computeIndent(rows, [keys.beta])).toEqual({
      index: 2,
      sourceKeys: [keys.beta],
      targetParentKey: keys.alpha,
    });
    expect(computeIndent(rows, [keys.projects]), "the first sibling has nothing to indent under").toBeNull();
  });

  it("outdents the item right after its parent", () => {
    expect(computeOutdent(rows, [keys.alphaTwo])).toEqual({
      index: 1,
      sourceKeys: [keys.alphaTwo],
      targetParentKey: keys.projects,
    });
    expect(computeOutdent(rows, [keys.inbox]), "root items cannot outdent").toBeNull();
  });

  it("reorders within siblings and stops at the edges", () => {
    expect(computeReorder(rows, [keys.alphaTwo], -1)).toEqual({
      index: 0,
      sourceKeys: [keys.alphaTwo],
      targetParentKey: keys.alpha,
    });
    expect(computeReorder(rows, [keys.alphaOne], -1)).toBeNull();
    expect(computeReorder(rows, [keys.projects], 1)).toEqual({
      index: 1,
      sourceKeys: [keys.projects],
      targetParentKey: null,
    });
    expect(computeReorder(rows, [keys.inbox], 1)).toBeNull();
  });

  it("moves a contiguous multi-selection as one ordered sibling run", () => {
    expect(computeReorder(rows, [keys.alphaOne, keys.alphaTwo], 1)).toBeNull();
    expect(computeOutdent(rows, [keys.alphaOne, keys.alphaTwo])).toEqual({
      index: 1,
      sourceKeys: [keys.alphaOne, keys.alphaTwo],
      targetParentKey: keys.projects,
    });
  });
});

describe("editing targets", () => {
  const rows = flattenOutline(sample, expanded);

  it("moves between visible rows and clamps the requested caret column", () => {
    expect(computeEditNavigation(rows, keys.alphaOne, 1, 8)).toEqual({ caret: 2, key: keys.alphaTwo });
    expect(computeEditNavigation(rows, keys.alphaTwo, -1, "end")).toEqual({ caret: 2, key: keys.alphaOne });
    expect(computeEditNavigation(rows, keys.projects, -1, 0)).toBeNull();
  });

  it("places a merge caret at the join and emits the merged content", () => {
    const remainder: OutlineContent = [{ text: " remainder", type: "text" }];
    expect(computeEditMergeTarget(rows, keys.alphaTwo, remainder)).toEqual({
      caret: 2,
      content: [{ text: "a1 remainder", type: "text" }],
      key: keys.alphaOne,
    });
    expect(computeEditMergeTarget(rows, keys.projects, [{ text: "orphan", type: "text" }])).toBeNull();
  });

  it("waits for a newly inserted sibling instead of selecting the displaced item", () => {
    const insertion = computeEditInsertion(rows, keys.alphaOne);
    expect(insertion).toEqual({ displacedKey: keys.alphaTwo, indexInParent: 1, parentKey: keys.alpha });
    expect(insertion === null ? null : resolveEditInsertion(rows, insertion)).toBeNull();

    const createdKey = "created item";
    const nextRows = flattenOutline(
      [
        item(keys.projects, "projects", [
          item(keys.alpha, "a", [item(keys.alphaOne, "a1"), item(createdKey, "created"), item(keys.alphaTwo, "a2")]),
          item(keys.beta, "b"),
        ]),
        item(keys.inbox, "inbox"),
      ],
      expanded,
    );
    expect(insertion === null ? null : resolveEditInsertion(nextRows, insertion)).toEqual({
      caret: 0,
      key: createdKey,
    });
  });

  it("finds a newly appended sibling when no item was previously displaced", () => {
    const insertion = computeEditInsertion(rows, keys.inbox);
    expect(insertion).toEqual({ displacedKey: null, indexInParent: 2, parentKey: null });

    const nextRows = flattenOutline([...sample, item("created root", "created")], expanded);
    expect(insertion === null ? null : resolveEditInsertion(nextRows, insertion)).toEqual({
      caret: 0,
      key: "created root",
    });
  });
});
