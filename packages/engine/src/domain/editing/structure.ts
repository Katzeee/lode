import type { Engine } from "../../core/index.js";
import { getSemanticChildren, moveOccurrence } from "../node/node.js";

// Outliner structure ops: indent / outdent / move-sibling. Each composite op is one undo
// step. They operate on the physical occurrence tree for sibling discovery and place through
// the node.ts `moveOccurrence` wrapper, which resolves the target parent to its canonical
// occurrence (children attach under the canonical — the rest of the domain's convention).
// Plain-outline (no transclusion) only; indent/outdent of a non-canonical ref is not handled.

/**
 * Indent a contiguous run of sibling occurrences one level: the first becomes the last child
 * of its previous sibling (the anchor); the rest append under that anchor in order. Returns
 * false (no-op) when the first occurrence has no previous sibling or is a root.
 */
export async function indent(engine: Engine, occurrenceIds: string[]): Promise<boolean> {
  if (occurrenceIds.length === 0) {
    return false;
  }
  return engine.batch(async () => {
    const firstId = occurrenceIds[0];
    if (firstId === undefined) {
      return false;
    }
    const first = await engine.getOccurrence(firstId);
    if (!first || first.parentOccurrenceId === null) {
      return false;
    }
    const siblings = engine.getChildOccurrenceIds(first.parentOccurrenceId);
    const firstIndex = siblings.indexOf(firstId);
    if (firstIndex <= 0) {
      return false; // first child (or stray) — no previous sibling to indent under
    }
    const anchor = siblings[firstIndex - 1];
    if (anchor === undefined) {
      return false;
    }
    // Append each selected occurrence under the anchor in order. As each leaves the parent the
    // next is moved by id, so parent-side shifts don't matter; the anchor's child count grows.
    for (const id of occurrenceIds) {
      const appendIndex = (await getSemanticChildren(engine, anchor)).length;
      await moveOccurrence(engine, id, anchor, appendIndex);
    }
    return true;
  });
}

/**
 * Outdent an occurrence one level: it becomes the sibling immediately after its parent (under the
 * grandparent). Returns false (no-op) for a root, and for a direct child of the root — outdenting
 * past the single root would mint a second root, which the single-root policy forbids.
 */
export async function outdent(engine: Engine, occurrenceId: string): Promise<boolean> {
  return engine.batch(async () => {
    const occ = await engine.getOccurrence(occurrenceId);
    if (!occ || occ.parentOccurrenceId === null) {
      return false;
    }
    const parent = occ.parentOccurrenceId;
    const grandparent = engine.getParentOccurrenceId(parent);
    if (grandparent === null) {
      return false; // parent is the root — outdent would mint a second root
    }
    const parentSiblings = engine.getChildOccurrenceIds(grandparent);
    const parentIndex = parentSiblings.indexOf(parent);
    await moveOccurrence(engine, occurrenceId, grandparent, parentIndex + 1);
    return true;
  });
}

/**
 * Move an occurrence one slot among its siblings (direction -1 = up, +1 = down). Returns false
 * (no-op) at the ends, for roots, or for an invalid direction. A single underlying move, so it
 * is already one undo step (no batch needed).
 */
export async function moveSibling(
  engine: Engine,
  occurrenceId: string,
  direction: -1 | 1,
): Promise<boolean> {
  if (direction !== -1 && direction !== 1) {
    return false;
  }
  const occ = await engine.getOccurrence(occurrenceId);
  if (!occ || occ.parentOccurrenceId === null) {
    return false;
  }
  const siblings = engine.getChildOccurrenceIds(occ.parentOccurrenceId);
  const i = siblings.indexOf(occurrenceId);
  const target = i + direction;
  if (target < 0 || target >= siblings.length) {
    return false;
  }
  await moveOccurrence(engine, occurrenceId, occ.parentOccurrenceId, target);
  return true;
}
