import type { BlockId, BlockView, MarkRange, TextSelection } from "../types.js";
import { getDeltaLength } from "../delta/utils.js";

export function isCollapsed(sel: TextSelection): boolean {
  return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

/** Determine if `a` precedes `b` in document order using precomputed `orderIndex`. */
function cmpCursor(
  a: { blockId: BlockId; offset: number },
  b: { blockId: BlockId; offset: number },
  orderIndex: Map<BlockId, number>,
): number {
  if (a.blockId === b.blockId) return a.offset - b.offset;
  const ai = orderIndex.get(a.blockId);
  const bi = orderIndex.get(b.blockId);
  if (ai == null || bi == null) return 0;
  return ai - bi;
}

export function normalizeSelection(
  sel: TextSelection,
  getBlock: (id: BlockId) => BlockView | undefined,
): TextSelection {
  // Build order from what we can traverse
  const seen = new Set<BlockId>();
  const order: BlockId[] = [];
  const a = getBlock(sel.anchor.blockId);
  const b = getBlock(sel.focus.blockId);
  if (!a || !b) return sel;
  // Light-weight: since we only need relative ordering, walk both anchor and focus depth-first ancestor paths; fall back to provided order
  order.push(sel.anchor.blockId, sel.focus.blockId);
  seen.add(sel.anchor.blockId);
  seen.add(sel.focus.blockId);
  const orderIndex = new Map<BlockId, number>();
  order.forEach((id, i) => orderIndex.set(id, i));
  if (cmpCursor(sel.anchor, sel.focus, orderIndex) <= 0) return sel;
  return { type: "text", anchor: sel.focus, focus: sel.anchor };
}

export function getBlockRange(
  blockId: BlockId,
  sel: TextSelection,
  getBlock: (id: BlockId) => BlockView | undefined,
  orderIndex: Map<BlockId, number>,
): MarkRange | null {
  const anchorIdx = orderIndex.get(sel.anchor.blockId);
  const focusIdx = orderIndex.get(sel.focus.blockId);
  if (anchorIdx == null || focusIdx == null) return null;
  const [startCursor, endCursor] = anchorIdx <= focusIdx
    ? [sel.anchor, sel.focus]
    : [sel.focus, sel.anchor];
  const startIdx = orderIndex.get(startCursor.blockId)!;
  const endIdx = orderIndex.get(endCursor.blockId)!;
  const selfIdx = orderIndex.get(blockId);
  if (selfIdx == null) return null;
  if (selfIdx < startIdx || selfIdx > endIdx) return null;

  const block = getBlock(blockId);
  if (!block) return null;
  const len = getDeltaLength(block.deltas);

  if (startCursor.blockId === blockId && endCursor.blockId === blockId) {
    const s = Math.min(startCursor.offset, endCursor.offset);
    const e = Math.max(startCursor.offset, endCursor.offset);
    return { start: s, end: e };
  }
  if (startCursor.blockId === blockId) return { start: startCursor.offset, end: len };
  if (endCursor.blockId === blockId) return { start: 0, end: endCursor.offset };
  return { start: 0, end: len };
}
