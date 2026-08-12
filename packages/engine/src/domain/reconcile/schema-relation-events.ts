import type { ContributionFact, SequenceAnchor } from "../fact/index.js";

type RelationEvent = Readonly<{
  fact: ContributionFact;
  operation: "add" | "remove";
  ownerId: string;
  targetId: string;
  anchor?: SequenceAnchor;
}>;

export const schemaApplicationEvent = relationEvent("schema-apply", "schema-remove", (mutation) => [
  mutation.nodeId,
  mutation.schemaId,
]);

export const schemaFieldEvent = relationEvent(
  "schema-field-add",
  "schema-field-remove",
  (mutation) => [mutation.schemaId, mutation.fieldDefinitionId],
);

export const schemaExtensionEvent = relationEvent(
  "schema-extension-add",
  "schema-extension-remove",
  (mutation) => [mutation.schemaId, mutation.baseSchemaId],
);

export const schemaTemplateNodeEvent = relationEvent(
  "schema-template-node-add",
  "schema-template-node-remove",
  (mutation) => [mutation.schemaId, mutation.templateNodeId],
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
          observes(removal.fact, addition.fact),
      )
    ) {
      continue;
    }
    insertUnique(list(relations, addition.ownerId), addition.targetId, addition.anchor);
  }
  return relations;
}

function relationEvent<
  AddKind extends
    "schema-apply" | "schema-field-add" | "schema-extension-add" | "schema-template-node-add",
  RemoveKind extends
    | "schema-remove"
    | "schema-field-remove"
    | "schema-extension-remove"
    | "schema-template-node-remove",
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

function observes(observer: ContributionFact, observed: ContributionFact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
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
  const index =
    after >= 0 ? after + 1 : before >= 0 ? before : anchor.fallback === "start" ? 0 : values.length;
  values.splice(index, 0, value);
}
