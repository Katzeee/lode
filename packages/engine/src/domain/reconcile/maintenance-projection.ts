import type { ContributionFact, Fact, Mutation } from "../fact/index.js";

export function purgedNodeIds(facts: readonly Fact[]): ReadonlySet<string> {
  return new Set(
    facts.flatMap((fact) =>
      fact.body.kind === "maintenance" && fact.body.action.kind === "node-purge"
        ? [fact.body.action.nodeId]
        : [],
    ),
  );
}

export function excludePurgedContributions(
  facts: readonly ContributionFact[],
  purged: ReadonlySet<string>,
): readonly ContributionFact[] {
  return purged.size === 0
    ? facts
    : facts.filter(
        (fact) => ![...purged].some((nodeId) => mutationReferencesNode(fact.body.mutation, nodeId)),
      );
}

export function mutationReferencesNode(mutation: Mutation, nodeId: string): boolean {
  if ("nodeId" in mutation && mutation.nodeId === nodeId) {
    return true;
  }
  if ("schemaId" in mutation && mutation.schemaId === nodeId) {
    return true;
  }
  if ("baseSchemaId" in mutation && mutation.baseSchemaId === nodeId) {
    return true;
  }
  if ("fieldDefinitionId" in mutation && mutation.fieldDefinitionId === nodeId) {
    return true;
  }
  if ("templateNodeId" in mutation && mutation.templateNodeId === nodeId) {
    return true;
  }
  if (mutation.kind === "template-node-detach" && mutation.ownerNodeId === nodeId) {
    return true;
  }
  if (mutation.kind === "field-materialize") {
    return mutation.ownerNodeId === nodeId || mutation.fieldNodeId === nodeId;
  }
  if (mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete") {
    return (
      mutation.ownerNodeId === nodeId ||
      (mutation.kind === "materialized-field-delete" && mutation.fieldNodeId === nodeId)
    );
  }
  if (mutation.kind === "field-initialize") {
    return (
      mutation.ownerNodeId === nodeId ||
      mutation.values.some((value) => value.kind === "reference" && value.nodeId === nodeId)
    );
  }
  return (
    (mutation.kind === "value-set" || mutation.kind === "value-unset") &&
    mutation.target.id === nodeId
  );
}
