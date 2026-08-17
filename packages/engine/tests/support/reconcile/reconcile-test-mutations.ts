import type { Mutation } from "../../../src/domain/fact/index.js";

export function fixturePrerequisites(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "supertag-template-node-add") {
    return [
      {
        kind: "occurrence-create",
        occurrenceId: mutation.templateOccurrenceId,
        nodeId: mutation.templateNodeId,
        parentNodeId: mutation.supertagId,
        anchor: mutation.anchor,
      },
    ];
  }
  if (mutation.kind === "field-materialize") {
    return [{ kind: "intrinsic-node-type-declare", nodeId: mutation.fieldNodeId, intrinsicNodeType: "field" }];
  }
  if (mutation.kind === "template-node-detach") {
    return [{ kind: "node-create", nodeId: mutation.instanceNodeId }];
  }
  return [];
}

export function fixtureConsequences(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "supertag-template-node-remove") {
    return [occurrenceDeletion(mutation.templateOccurrenceId, mutation.supertagId, mutation.previousAnchor)];
  }
  if (mutation.kind === "field-value-delete") {
    return [occurrenceDeletion(mutation.valueOccurrenceId, mutation.previousParentNodeId, mutation.previousAnchor)];
  }
  if (mutation.kind === "materialized-field-delete") {
    return [occurrenceDeletion(mutation.fieldOccurrenceId, mutation.previousParentNodeId, mutation.previousAnchor)];
  }
  if (mutation.kind === "template-node-detach") {
    return [
      {
        kind: "occurrence-create",
        occurrenceId: mutation.instanceOccurrenceId,
        nodeId: mutation.instanceNodeId,
        parentNodeId: mutation.ownerNodeId,
        anchor: mutation.anchor,
      },
    ];
  }
  return [];
}

function occurrenceDeletion(
  occurrenceId: string,
  previousParentNodeId: string | undefined,
  previousAnchor: Extract<Mutation, { kind: "occurrence-delete" }>["previousAnchor"],
): Mutation {
  return {
    kind: "occurrence-delete",
    occurrenceId,
    previousParentNodeId,
    previousAnchor,
  };
}
