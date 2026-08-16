import { factObserves, type ContributionFact, type SequenceAnchor } from "../fact/index.js";

type RelationEvent = Readonly<{
  fact: ContributionFact;
  operation: "add" | "remove";
  ownerId: string;
  targetId: string;
  anchor?: SequenceAnchor;
}>;

export const supertagApplicationEvent = relationEvent("supertag-apply", "supertag-remove", (mutation) => [
  mutation.nodeId,
  mutation.supertagId,
]);

export const supertagExtensionEvent = relationEvent(
  "supertag-extension-add",
  "supertag-extension-remove",
  (mutation) => [mutation.supertagId, mutation.baseSupertagId],
);

export function observedRelations(
  active: readonly ContributionFact[],
  eventOf: (fact: ContributionFact) => RelationEvent | null,
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

function relationEvent<
  AddKind extends "supertag-apply" | "supertag-extension-add" | "supertag-template-node-add",
  RemoveKind extends "supertag-remove" | "supertag-extension-remove" | "supertag-template-node-remove",
>(
  addKind: AddKind,
  removeKind: RemoveKind,
  identities: (
    mutation: Extract<ContributionFact["body"]["mutation"], { kind: AddKind | RemoveKind }>,
  ) => readonly [string, string],
): (fact: ContributionFact) => RelationEvent | null {
  return (fact) => {
    const mutation = fact.body.mutation;
    if (mutation.kind !== addKind && mutation.kind !== removeKind) {
      return null;
    }
    const typed = mutation as Extract<typeof mutation, { kind: AddKind | RemoveKind }>;
    const [ownerId, targetId] = identities(typed);
    return {
      fact,
      operation: mutation.kind === addKind ? "add" : "remove",
      ownerId,
      targetId,
      ...(mutation.kind === addKind && "anchor" in mutation ? { anchor: mutation.anchor } : {}),
    };
  };
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
