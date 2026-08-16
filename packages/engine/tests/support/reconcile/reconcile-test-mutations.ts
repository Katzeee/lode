import type { Mutation } from "../../../src/domain/fact/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function fixturePrerequisites(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "supertag-field-add") {
    return [
      { kind: "node-create", nodeId: mutation.fieldNodeId },
      { kind: "node-type-declare", nodeId: mutation.fieldNodeId, nodeType: "field" },
      {
        kind: "occurrence-create",
        occurrenceId: mutation.fieldOccurrenceId,
        nodeId: mutation.fieldNodeId,
        parentNodeId: mutation.supertagId,
        anchor: mutation.anchor,
      },
    ];
  }
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
  if (mutation.kind === "field-initialize") {
    const result: Mutation[] = [
      {
        kind: "node-create",
        nodeId: mutation.fieldNodeId,
        seed: {
          text: [],
        },
      },
      { kind: "node-type-declare", nodeId: mutation.fieldNodeId, nodeType: "field" },
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
  if (mutation.kind === "field-materialize") {
    return [{ kind: "node-type-declare", nodeId: mutation.fieldNodeId, nodeType: "field" }];
  }
  if (mutation.kind === "template-node-detach") {
    return [{ kind: "node-create", nodeId: mutation.instanceNodeId }];
  }
  return [];
}

export function fixtureConsequences(mutation: Mutation): readonly Mutation[] {
  if (mutation.kind === "supertag-field-remove") {
    return [{ kind: "node-delete", nodeId: mutation.fieldNodeId }];
  }
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
