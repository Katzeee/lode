import type { Mutation } from "../fact/index.js";
import type { Projection } from "./projection-types.js";

export function materializedFieldProblem(
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
  projection: Projection,
): string | null {
  for (const [nodeId, label] of [
    [mutation.ownerNodeId, "Field owner"],
    [mutation.fieldDefinitionId, "Field Definition"],
    [mutation.fieldNodeId, "Materialized Field"],
  ] as const) {
    if (!projection.nodes[nodeId]) {
      return `${label} Node does not exist: ${nodeId}`;
    }
  }
  const occurrence = projection.occurrences[mutation.fieldOccurrenceId];
  if (occurrence?.nodeId !== mutation.fieldNodeId) {
    return "Materialized Field Occurrence does not present the Field Node";
  }
  if (occurrence.parentNodeId !== mutation.ownerNodeId) {
    return "Materialized Field Occurrence is not stored under its owner Node";
  }
  for (const fields of Object.values(projection.materializedFields)) {
    for (const field of fields) {
      if (!sameMaterialization(field, mutation) && identitiesOverlap(field, mutation)) {
        return "Materialized Field identity is already bound";
      }
    }
  }
  return null;
}

export function assertMaterializedField(
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
  projection: Projection,
): void {
  const problem = materializedFieldProblem(mutation, projection);
  if (problem) {
    throw new Error(problem);
  }
}

function sameMaterialization(
  field: Projection["materializedFields"][string][number],
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
): boolean {
  return (
    field.ownerNodeId === mutation.ownerNodeId &&
    field.fieldDefinitionId === mutation.fieldDefinitionId &&
    field.fieldNodeId === mutation.fieldNodeId &&
    field.fieldOccurrenceId === mutation.fieldOccurrenceId
  );
}

function identitiesOverlap(
  field: Projection["materializedFields"][string][number],
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
): boolean {
  return (
    (field.ownerNodeId === mutation.ownerNodeId &&
      field.fieldDefinitionId === mutation.fieldDefinitionId) ||
    field.fieldNodeId === mutation.fieldNodeId ||
    field.fieldOccurrenceId === mutation.fieldOccurrenceId
  );
}
