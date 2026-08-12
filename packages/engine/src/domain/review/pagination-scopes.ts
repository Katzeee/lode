import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type Fact,
  type Mutation,
} from "../fact/index.js";
import { deriveActivation } from "../reconcile/support.js";

type ManagedAssociations = Readonly<{
  schemasByNode: ReadonlyMap<string, ReadonlySet<string>>;
  schemasByField: ReadonlyMap<string, ReadonlySet<string>>;
}>;

export function reviewPaginationScopes(
  pending: ReadonlyMap<string, ContributionFact>,
  facts: readonly Fact[],
): ReadonlyMap<string, readonly ContributionFact[]> {
  const nodeByOccurrence = occurrenceNodeIndex(facts);
  const managed = managedAssociations(facts);
  const groups: { keys: Set<string>; facts: ContributionFact[] }[] = [];
  for (const fact of pending.values()) {
    const keys = new Set(scopeKeys(fact.body.mutation, nodeByOccurrence, managed));
    const matching = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => [...keys].some((key) => group.keys.has(key)));
    const first = matching[0];
    if (!first) {
      groups.push({ keys, facts: [fact] });
      continue;
    }
    first.group.facts.push(fact);
    keys.forEach((key) => first.group.keys.add(key));
    for (const { group, index } of matching.slice(1).reverse()) {
      group.keys.forEach((key) => first.group.keys.add(key));
      first.group.facts.push(...group.facts);
      groups.splice(index, 1);
    }
  }
  return new Map(
    groups.map((group) => [
      canonicalJson([...group.keys].sort(stableStringCompare)),
      group.facts.sort(compareFacts),
    ]),
  );
}

function scopeKeys(
  mutation: Mutation,
  nodeByOccurrence: ReadonlyMap<string, string>,
  managed: ManagedAssociations,
): readonly string[] {
  switch (mutation.kind) {
    case "text-splice":
    case "text-mark":
      return [canonicalJson(["node-content", mutation.nodeId]), associatedNode(mutation.nodeId)];
    case "value-set":
    case "value-unset":
      return [
        canonicalJson([
          "value",
          mutation.owner.kind,
          mutation.owner.id,
          mutation.namespace,
          mutation.key,
        ]),
        ...valueAssociation(mutation, nodeByOccurrence, managed),
      ];
    case "schema-apply":
    case "schema-remove":
      return [
        canonicalJson(["schema-application", mutation.nodeId]),
        associatedNode(mutation.nodeId),
        associatedNode(mutation.schemaId),
      ];
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
      return [
        canonicalJson(["schema-template", mutation.schemaId]),
        associatedNode(mutation.schemaId),
        associatedNode(mutation.fieldDefinitionId),
      ];
    case "schema-extension-add":
    case "schema-extension-remove":
      return [
        canonicalJson(["schema-extension", mutation.schemaId]),
        associatedNode(mutation.schemaId),
        associatedNode(mutation.baseSchemaId),
      ];
    case "field-materialize":
      return [
        canonicalJson(["materialized-field", mutation.ownerNodeId, mutation.fieldDefinitionId]),
        associatedNode(mutation.ownerNodeId),
        associatedNode(mutation.fieldDefinitionId),
        associatedNode(mutation.fieldNodeId),
      ];
    case "field-initialize":
      return fieldInitializationScopes(mutation);
    case "occurrence-create":
      return [
        structureParent(mutation.parentOccurrenceId),
        ...occurrenceAssociation(mutation.occurrenceId, mutation.nodeId),
      ];
    case "occurrence-restore":
      return [
        structureParent(mutation.parentOccurrenceId),
        ...occurrenceAssociation(
          mutation.occurrenceId,
          nodeByOccurrence.get(mutation.occurrenceId),
        ),
      ];
    case "occurrence-delete":
      return [
        ...(mutation.previousParentOccurrenceId === undefined
          ? [canonicalJson(["structure-occurrence", mutation.occurrenceId])]
          : [structureParent(mutation.previousParentOccurrenceId)]),
        ...occurrenceAssociation(
          mutation.occurrenceId,
          nodeByOccurrence.get(mutation.occurrenceId),
        ),
      ];
    case "occurrence-move":
      return [
        ...new Set([
          structureParent(mutation.parentOccurrenceId),
          ...(mutation.previousParentOccurrenceId === undefined
            ? []
            : [structureParent(mutation.previousParentOccurrenceId)]),
          ...occurrenceAssociation(
            mutation.occurrenceId,
            nodeByOccurrence.get(mutation.occurrenceId),
          ),
        ]),
      ];
    case "canonical-occurrence-set":
      return [canonicalJson(["canonical", mutation.nodeId]), associatedNode(mutation.nodeId)];
    case "node-create":
    case "node-delete":
    case "node-restore":
      return [canonicalJson(["lifecycle", mutation.nodeId]), associatedNode(mutation.nodeId)];
  }
}

function fieldInitializationScopes(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
): readonly string[] {
  return [
    canonicalJson(["materialized-field", mutation.ownerNodeId, mutation.fieldDefinitionId]),
    associatedNode(mutation.ownerNodeId),
    associatedNode(mutation.schemaId),
    associatedNode(mutation.fieldDefinitionId),
    ...mutation.values.flatMap((value) =>
      value.kind === "reference" ? [associatedNode(value.nodeId)] : [],
    ),
  ];
}

function occurrenceNodeIndex(facts: readonly Fact[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const fact of facts) {
    if (fact.body.kind === "contribution" && fact.body.mutation.kind === "occurrence-create") {
      result.set(fact.body.mutation.occurrenceId, fact.body.mutation.nodeId);
    }
  }
  return result;
}

function occurrenceAssociation(occurrenceId: string, nodeId?: string): readonly string[] {
  return [
    canonicalJson(["associated-occurrence", occurrenceId]),
    ...(nodeId ? [associatedNode(nodeId)] : []),
  ];
}

function valueAssociation(
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
  nodeByOccurrence: ReadonlyMap<string, string>,
  managed: ManagedAssociations,
): readonly string[] {
  if (mutation.owner.kind === "node") {
    return [
      associatedNode(mutation.owner.id),
      ...[...(managed.schemasByNode.get(mutation.owner.id) ?? [])].map(managedSchema),
    ];
  }
  if (mutation.owner.kind === "occurrence") {
    return occurrenceAssociation(mutation.owner.id, nodeByOccurrence.get(mutation.owner.id));
  }
  if (mutation.owner.kind === "schema") {
    return [
      canonicalJson(["associated-value-owner", "schema", mutation.owner.id]),
      managedSchema(mutation.owner.id),
      managedSchemaField(mutation.owner.id, mutation.key),
    ];
  }
  const schemas = [...(managed.schemasByField.get(mutation.owner.id) ?? [])];
  return [
    canonicalJson(["associated-value-owner", "field", mutation.owner.id]),
    ...schemas.flatMap((schemaId) => [
      managedSchema(schemaId),
      managedSchemaField(schemaId, mutation.owner.id),
    ]),
  ];
}

function managedAssociations(facts: readonly Fact[]): ManagedAssociations {
  const active = deriveActivation(facts, "review").activeContributionIds;
  const winners = new Map<string, ContributionFact>();
  for (const fact of facts) {
    if (!isContribution(fact) || !active.has(fact.id)) {
      continue;
    }
    const mutation = fact.body.mutation;
    if (mutation.kind !== "value-set" && mutation.kind !== "value-unset") {
      continue;
    }
    const address = canonicalJson([
      mutation.owner.kind,
      mutation.owner.id,
      mutation.namespace,
      mutation.key,
    ]);
    const previous = winners.get(address);
    if (!previous || compareFacts(previous, fact) < 0) {
      winners.set(address, fact);
    }
  }
  const schemasByNode = new Map<string, Set<string>>();
  const schemasByField = new Map<string, Set<string>>();
  for (const fact of winners.values()) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "value-set") {
      continue;
    }
    if (
      mutation.owner.kind === "node" &&
      mutation.namespace === "property" &&
      mutation.key === "schemaId" &&
      typeof mutation.value === "string"
    ) {
      addRelation(schemasByNode, mutation.owner.id, mutation.value);
    }
    if (mutation.owner.kind === "schema") {
      addRelation(schemasByField, mutation.key, mutation.owner.id);
    }
  }
  return { schemasByNode, schemasByField };
}

function isContribution(fact: Fact): fact is ContributionFact {
  return fact.body.kind === "contribution";
}

function addRelation(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function managedSchema(schemaId: string): string {
  return canonicalJson(["managed-schema", schemaId]);
}

function managedSchemaField(schemaId: string, fieldId: string): string {
  return canonicalJson(["managed-schema-field", schemaId, fieldId]);
}

function associatedNode(nodeId: string): string {
  return canonicalJson(["associated-node", nodeId]);
}

function structureParent(parentOccurrenceId: string | null): string {
  return canonicalJson(["structure-parent", parentOccurrenceId]);
}
