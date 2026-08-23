import { factObserves, type FactAction, type SequenceAnchor } from "../fact/index.js";

type RelationEvent = Readonly<{
  fact: FactAction;
  operation: "add" | "remove";
  ownerId: string;
  targetId: string;
  anchor?: SequenceAnchor;
}>;

export function supertagExtensionEvent(fact: FactAction): RelationEvent | null {
  const action = fact.action;
  if (action.kind !== "supertag-extension-add" && action.kind !== "supertag-extension-remove") {
    return null;
  }
  return {
    fact,
    operation: action.kind === "supertag-extension-add" ? "add" : "remove",
    ownerId: action.supertagId,
    targetId: action.baseSupertagId,
    ...(action.kind === "supertag-extension-add" ? { anchor: action.anchor } : {}),
  };
}

export function observedRelations(
  active: readonly FactAction[],
  eventOf: (fact: FactAction) => RelationEvent | null,
  ownerNodeIds: ReadonlySet<string>,
  targetNodeIds: ReadonlySet<string>,
): Map<string, string[]> {
  const events = active.map(eventOf).filter((event) => event !== null);
  const additions = events.filter((event) => event.operation === "add");
  const removals = events.filter((event) => event.operation === "remove");
  const relations = new Map<string, string[]>();
  for (const addition of additions) {
    if (
      !addition.anchor ||
      !ownerNodeIds.has(addition.ownerId) ||
      !targetNodeIds.has(addition.targetId) ||
      removals.some(
        (removal) =>
          removal.ownerId === addition.ownerId &&
          removal.targetId === addition.targetId &&
          factObserves(removal.fact, addition.fact),
      )
    ) {
      continue;
    }
    insertUnique(list(relations, addition.ownerId), addition.targetId, addition.anchor);
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
