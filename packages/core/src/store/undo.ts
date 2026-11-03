// Purpose: Constructs the one undo manager configuration every replica and the command history share.

import { UndoManager, type LoroDoc } from "loro-crdt";
import { EXCLUDED } from "./origins.ts";

/**
 * Loro's undo limit while nothing is to be evicted: effectively unbounded, because Loro trims at any
 * push, even inside a command; the command history evicts whole commands itself.
 */
export const UNBOUNDED_UNDO_STEPS = 2 ** 30;

/**
 * Every commit is its own undo item (`mergeInterval` 0), so the history counts a command's items
 * exactly, and excluded origins are never undo items.
 */
export function newUndoManager(doc: LoroDoc): UndoManager {
  return new UndoManager(doc, {
    mergeInterval: 0,
    maxUndoSteps: UNBOUNDED_UNDO_STEPS,
    excludeOriginPrefixes: [EXCLUDED],
  });
}
