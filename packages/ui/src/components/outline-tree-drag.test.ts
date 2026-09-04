import { describe, expect, it } from "vitest";

import { OUTLINE_INDENT, resolveDragDepth, resolveDropMove } from "./outline-tree-drag.js";
import { flattenOutline, type OutlineItemViewModel } from "./outline-tree-view-model.js";

const item = (key: string, children?: readonly OutlineItemViewModel[]): OutlineItemViewModel => ({
  accessibilityLabel: key,
  children,
  content: [],
  key,
});

describe("resolveDragDepth", () => {
  it("measures tree depth from the hovered Node bullet rather than its presentation column", () => {
    const targetBulletX = 540;

    expect(resolveDragDepth(3, targetBulletX, targetBulletX)).toBe(3);
    expect(resolveDragDepth(3, targetBulletX, targetBulletX - OUTLINE_INDENT)).toBe(2);
    expect(resolveDragDepth(3, targetBulletX, targetBulletX + OUTLINE_INDENT * 2)).toBe(5);
  });

  it("allows a Node to become a child of the preceding Node", () => {
    const rows = flattenOutline(
      [item("projects", [item("lode", [item("owner", [item("kei"), item("team")]), item("review")])])],
      new Set(["projects", "lode", "owner"]),
    );
    const team = rows.find((row) => row.key === "team");

    expect(resolveDropMove(rows, ["review"], team, 4)).toEqual({
      index: 0,
      sourceKeys: ["review"],
      targetParentKey: "team",
    });
  });
});
