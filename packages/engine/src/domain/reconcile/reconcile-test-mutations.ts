import type { Mutation } from "../fact/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function fixturePrerequisites(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "schema-field-add") {
    return [
      { kind: "node-create", nodeId: mutation.fieldNodeId },
      {
        kind: "occurrence-create",
        occurrenceId: mutation.fieldOccurrenceId,
        nodeId: mutation.fieldNodeId,
        parentNodeId: mutation.schemaId,
        anchor: mutation.anchor,
      },
    ];
  }
  if (mutation.kind === "schema-template-node-add") {
    return [
      {
        kind: "occurrence-create",
        occurrenceId: mutation.templateOccurrenceId,
        nodeId: mutation.templateNodeId,
        parentNodeId: mutation.schemaId,
        anchor: mutation.anchor,
      },
    ];
  }
  if (mutation.kind === "field-initialize") {
    const result: Mutation[] = [
      {
        kind: "node-create",
        nodeId: mutation.fieldNodeId,
        seed: {
          text: [],
          properties: { fieldDefinitionId: mutation.fieldDefinitionId },
          metadata: { initializedBy: mutation.source },
        },
      },
      {
        kind: "occurrence-create",
        occurrenceId: mutation.fieldOccurrenceId,
        nodeId: mutation.fieldNodeId,
        parentNodeId: mutation.ownerNodeId,
        anchor: end,
      },
    ];
    for (const value of mutation.values) {
      if (value.kind === "text") {
        result.push({
          kind: "node-create",
          nodeId: value.nodeId,
          seed: {
            text: [...value.value].map((character) => ({ value: character, attributes: {} })),
            properties: {},
            metadata: { initializedBy: mutation.source },
          },
        });
      }
      result.push({
        kind: "occurrence-create",
        occurrenceId: value.occurrenceId,
        nodeId: value.nodeId,
        parentNodeId: mutation.fieldNodeId,
        anchor: end,
      });
    }
    return result;
  }
  if (mutation.kind === "template-node-detach") {
    return [{ kind: "node-create", nodeId: mutation.instanceNodeId }];
  }
  return [];
}

export function fixtureConsequences(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "schema-field-remove") {
    return [
      occurrenceDeletion(mutation.fieldOccurrenceId, mutation.schemaId, mutation.previousAnchor),
    ];
  }
  if (mutation.kind === "schema-template-node-remove") {
    return [
      occurrenceDeletion(mutation.templateOccurrenceId, mutation.schemaId, mutation.previousAnchor),
    ];
  }
  if (mutation.kind === "field-value-delete") {
    return [
      occurrenceDeletion(
        mutation.valueOccurrenceId,
        mutation.previousParentNodeId,
        mutation.previousAnchor,
      ),
    ];
  }
  if (mutation.kind === "materialized-field-delete") {
    return [
      occurrenceDeletion(
        mutation.fieldOccurrenceId,
        mutation.previousParentNodeId,
        mutation.previousAnchor,
      ),
    ];
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
