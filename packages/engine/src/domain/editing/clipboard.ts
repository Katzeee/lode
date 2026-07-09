import type { Engine, NodeOccurrence } from "../../core/index.js";
import { cloneOccurrence, getSemanticChildren } from "../node/node.js";

// Composite clipboard ops. The clipboard BUFFER lives client-side; the engine only provides
// deep-clone-under-target as one undoable intent. Both ops reuse cloneOccurrence (already
// grouped) and wrap the whole call set in one batch, so pasting N sources is one undo step.

/**
 * Paste (deep-clone) one or more source occurrences under a target parent in one undo step.
 * `index` is the position of the first clone among the target's existing children; subsequent
 * clones follow in source order. Returns the new clones.
 */
export async function paste(
  doc: Engine,
  sourceOccurrenceIds: string[],
  targetParentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence[]> {
  return doc.batch(async () => {
    const start = index ?? (await getSemanticChildren(doc, targetParentOccurrenceId)).length;
    const created: NodeOccurrence[] = [];
    for (const [offset, sourceId] of sourceOccurrenceIds.entries()) {
      created.push(await cloneOccurrence(doc, sourceId, targetParentOccurrenceId, start + offset));
    }
    return created;
  });
}

/** Duplicate an occurrence in place — same parent, immediately after the original. One undo step.
 *  A root has no parent to duplicate beside, so it clones under itself (never mints a second root). */
export async function duplicate(doc: Engine, occurrenceId: string): Promise<NodeOccurrence> {
  return doc.batch(async () => {
    const occ = await doc.mustGetOccurrence(occurrenceId);
    const parent = occ.parentOccurrenceId ?? occurrenceId;
    const siblings = doc.getChildOccurrenceIds(parent);
    const selfIndex = occ.parentOccurrenceId ? siblings.indexOf(occurrenceId) : -1;
    return cloneOccurrence(doc, occurrenceId, parent, selfIndex + 1);
  });
}
