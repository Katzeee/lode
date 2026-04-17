import type { CommandDef, EngineContext } from "../plugins/index.js";
import type { BlockId, Selection } from "../types.js";
import { getDeltaLength, sliceDelta, mergeDelta } from "../delta/utils.js";

function normalizeCursors(
  ctx: EngineContext,
  sel: { anchor: { blockId: BlockId; offset: number }; focus: { blockId: BlockId; offset: number } },
): [{ blockId: BlockId; offset: number }, { blockId: BlockId; offset: number }] {
  const order = ctx.engine.getAllBlockIds();
  const ai = order.indexOf(sel.anchor.blockId);
  const fi = order.indexOf(sel.focus.blockId);
  if (ai === fi) {
    return sel.anchor.offset <= sel.focus.offset ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  }
  return ai < fi ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}

export const splitBlock: CommandDef = {
  execute(ctx, args) {
    const a = args as { blockId?: BlockId; offset?: number } | undefined;
    if (a?.blockId != null && typeof a.offset === "number") {
      ctx.engine.splitBlock(a.blockId, a.offset);
      return;
    }
    const sel = ctx.engine.getSelection();
    if (!sel || sel.type !== "text") return;
    ctx.engine.splitBlock(sel.focus.blockId, sel.focus.offset);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const a = args as { blockId?: BlockId; offset?: number } | undefined;
    if (a?.blockId != null && typeof a.offset === "number") return true;
    const sel = ctx.engine.getSelection();
    return !!sel && sel.type === "text";
  },
};

export const mergeBlockWithPrev: CommandDef = {
  execute(ctx, args) {
    const a = args as { blockId?: BlockId } | undefined;
    const id = a?.blockId ?? selectionAnchorBlock(ctx.engine.getSelection());
    if (id != null) ctx.engine.mergeBlockWithPrev(id);
  },
  can(ctx, args) {
    if (ctx.engine.readonly) return false;
    const a = args as { blockId?: BlockId } | undefined;
    const id = a?.blockId ?? selectionAnchorBlock(ctx.engine.getSelection());
    if (id == null) return false;
    return ctx.engine.getPrev(id) != null;
  },
};

export const deleteSelection: CommandDef = {
  execute(ctx) {
    const sel = ctx.engine.getSelection();
    if (!sel) return;
    if (sel.type === "block") {
      ctx.engine.batch(() => {
        for (const id of [...sel.blockIds]) ctx.engine.deleteBlock(id);
      });
      return;
    }
    // TextSelection
    const [s, e] = normalizeCursors(ctx, sel);
    ctx.engine.batch(() => {
      if (s.blockId === e.blockId) {
        const view = ctx.engine.getBlock(s.blockId);
        if (!view) return;
        const before = sliceDelta(view.deltas, 0, s.offset);
        const after = sliceDelta(view.deltas, e.offset, getDeltaLength(view.deltas));
        ctx.engine.replaceDeltas(s.blockId, mergeDelta(before, after));
        ctx.engine.setSelection({
          type: "text",
          anchor: { blockId: s.blockId, offset: s.offset },
          focus: { blockId: s.blockId, offset: s.offset },
        });
        return;
      }
      // Spans multiple blocks: keep anchor prefix + focus suffix in anchor block; delete intermediate blocks.
      const order = ctx.engine.getAllBlockIds();
      const startIdx = order.indexOf(s.blockId);
      const endIdx = order.indexOf(e.blockId);
      const startView = ctx.engine.getBlock(s.blockId);
      const endView = ctx.engine.getBlock(e.blockId);
      if (!startView || !endView) return;
      const before = sliceDelta(startView.deltas, 0, s.offset);
      const after = sliceDelta(endView.deltas, e.offset, getDeltaLength(endView.deltas));
      ctx.engine.replaceDeltas(s.blockId, mergeDelta(before, after));
      for (let i = endIdx; i > startIdx; i--) {
        ctx.engine.deleteBlock(order[i]);
      }
      ctx.engine.setSelection({
        type: "text",
        anchor: { blockId: s.blockId, offset: s.offset },
        focus: { blockId: s.blockId, offset: s.offset },
      });
    });
  },
  can(ctx) {
    if (ctx.engine.readonly) return false;
    return ctx.engine.getSelection() != null;
  },
};

function selectionAnchorBlock(sel: Selection): BlockId | undefined {
  if (!sel) return undefined;
  if (sel.type === "text") return sel.anchor.blockId;
  return sel.blockIds[0];
}
