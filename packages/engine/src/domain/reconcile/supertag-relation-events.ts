import type { FactAction, SequenceAnchor } from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";

export function observedSupertagExtensions(
  active: readonly FactAction[],
  ownerNodeIds: ReadonlySet<string>,
  targetNodeIds: ReadonlySet<string>,
): Map<string, string[]> {
  const relations = new Map<string, string[]>();
  for (const state of causalCollectionStates(active, "supertag-extension")) {
    const action = state.addition.action;
    if (state.removed || !ownerNodeIds.has(action.supertagId) || !targetNodeIds.has(action.baseSupertagId)) {
      continue;
    }
    insertUnique(list(relations, action.supertagId), action.baseSupertagId, action.anchor);
  }
  return relations;
}

function list(map: Map<string, string[]>, key: string): string[] {
  const value = map.get(key) ?? [];
  map.set(key, value);
  return value;
}

function insertUnique(values: string[], value: string, anchor: SequenceAnchor): void {
  const existing = values.indexOf(value);
  if (existing >= 0) {
    values.splice(existing, 1);
  }
  const after = anchor.after === null ? -1 : values.indexOf(anchor.after);
  const before = anchor.before === null ? -1 : values.indexOf(anchor.before);
  const index = after >= 0 ? after + 1 : before >= 0 ? before : anchor.fallback === "start" ? 0 : values.length;
  values.splice(index, 0, value);
}
