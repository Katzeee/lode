import { describe, expect, it, vi } from "vitest";

import {
  resolveOutlinePresentation,
  type OutlinePresentationRegistry,
  type OutlinePresentationRowState,
} from "./outline-presentation.js";

type Presentation = Readonly<{ glyph: string }>;
type Action = Readonly<{ type: "open" }>;

const state: OutlinePresentationRowState = {
  depth: 2,
  expanded: false,
  expandable: true,
  hasChildren: true,
  selected: false,
};

describe("outline presentation seam", () => {
  it("passes opaque presentation data and row state to an injected registry", () => {
    const resolve = vi.fn<OutlinePresentationRegistry<Presentation, Action>["resolve"]>((presentation, context) => ({
      bullet: { action: { type: "open" }, content: presentation.glyph },
      childrenLayout: context.state.hasChildren ? "beside" : "indented",
    }));
    const onAction = vi.fn<(key: string, action: Action) => void>();

    const presentation = resolveOutlinePresentation(
      { resolve },
      { glyph: "registered glyph" },
      "opaque item key",
      "Visible item",
      state,
      onAction,
    );

    expect(resolve).toHaveBeenCalledWith(
      { glyph: "registered glyph" },
      expect.objectContaining({ canDispatch: true, itemKey: "opaque item key", itemLabel: "Visible item", state }),
    );
    expect(presentation).toMatchObject({
      bullet: { content: "registered glyph" },
      childrenLayout: "beside",
    });

    presentation.bullet.onActivate?.();
    expect(onAction).toHaveBeenCalledWith("opaque item key", { type: "open" });
  });

  it("keeps a registered action inert when the host does not handle presentation actions", () => {
    const presentation = resolveOutlinePresentation(
      {
        resolve: ({ glyph }: Presentation) => ({ bullet: { action: { type: "open" }, content: glyph } }),
      },
      { glyph: "registered glyph" },
      "opaque item key",
      "Visible item",
      state,
    );

    expect(presentation.bullet.onActivate).toBeUndefined();
  });
});
