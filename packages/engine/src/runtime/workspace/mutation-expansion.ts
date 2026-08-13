import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  stableStringCompare,
  type JsonValue,
  type Mutation,
  type NodeSeed,
} from "../../domain/fact/index.js";
import {
  atomicMutationWrite,
  singleMutationWrite,
  type MutationWrite,
} from "../../domain/edit/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function expandMutation(mutation: Mutation, available: Projection): MutationWrite {
  switch (mutation.kind) {
    case "schema-field-add":
      return atomicExpansion([
        ...createNodeUnlessPresent(mutation.fieldNodeId, available),
        ...createOccurrenceUnlessPresent(
          mutation.fieldOccurrenceId,
          mutation.fieldNodeId,
          mutation.schemaId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "schema-field-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.fieldOccurrenceId, available)]);
    case "schema-template-node-add":
      return atomicExpansion([
        ...createOccurrenceUnlessPresent(
          mutation.templateOccurrenceId,
          mutation.templateNodeId,
          mutation.schemaId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "schema-template-node-remove":
      return atomicExpansion([
        mutation,
        ...deletePlacement(mutation.templateOccurrenceId, available),
      ]);
    case "field-initialize":
      return atomicExpansion(expandFieldInitialization(mutation, available));
    case "template-node-detach":
      return atomicExpansion(expandTemplateDetachment(mutation, available));
    case "field-value-delete":
      return atomicExpansion([mutation, ...deletePlacement(mutation.valueOccurrenceId, available)]);
    case "materialized-field-delete":
      return atomicExpansion([mutation, ...deletePlacement(mutation.fieldOccurrenceId, available)]);
    case "node-delete":
      return ownedSubtreeDeletion(mutation.nodeId, available);
    case "occurrence-delete": {
      const occurrence = available.occurrences[mutation.occurrenceId];
      return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
        ? ownedSubtreeDeletion(occurrence.nodeId, available)
        : singleMutationWrite(mutation);
    }
    case "node-create":
    case "node-restore":
    case "occurrence-create":
    case "occurrence-restore":
    case "occurrence-move":
    case "node-owner-set":
    case "schema-apply":
    case "schema-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "field-materialize":
    case "text-splice":
    case "text-mark":
    case "value-set":
    case "value-unset":
      return singleMutationWrite(mutation);
  }
}

function atomicExpansion(mutations: readonly Mutation[]): MutationWrite {
  const [first, ...rest] = mutations;
  if (!first) {
    throw new Error("Atomic mutation expansion requires at least one mutation");
  }
  return atomicMutationWrite([first, ...rest]);
}

function ownedSubtreeDeletion(nodeId: string, available: Projection): MutationWrite {
  return atomicExpansion(deleteOwnedSubtree(nodeId, available));
}

function deleteOwnedSubtree(nodeId: string, available: Projection): readonly Mutation[] {
  const nodeIds = [nodeId];
  const visited = new Set(nodeIds);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const parentNodeId = nodeIds[index];
    const children = Object.entries(available.nodeOwners)
      .filter(
        ([ownedNodeId, ownerNodeId]) => ownerNodeId === parentNodeId && !visited.has(ownedNodeId),
      )
      .map(([ownedNodeId]) => ownedNodeId)
      .sort(stableStringCompare);
    children.forEach((ownedNodeId) => visited.add(ownedNodeId));
    nodeIds.push(...children);
  }
  return nodeIds.reverse().map((ownedNodeId) => ({ kind: "node-delete", nodeId: ownedNodeId }));
}

function expandFieldInitialization(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  available: Projection,
): readonly Mutation[] {
  const result: Mutation[] = [
    ...createNodeUnlessPresent(
      mutation.fieldNodeId,
      available,
      nodeSeed(
        {},
        { initializedBy: mutation.source },
        { fieldDefinitionId: mutation.fieldDefinitionId },
      ),
    ),
    ...createOccurrenceUnlessPresent(
      mutation.fieldOccurrenceId,
      mutation.fieldNodeId,
      mutation.ownerNodeId,
      END,
      available,
    ),
  ];
  for (const value of mutation.values) {
    if (value.kind === "text") {
      result.push(
        ...createNodeUnlessPresent(
          value.nodeId,
          available,
          nodeSeed(
            {},
            { initializedBy: mutation.source },
            {},
            [...value.value].map((character) => ({ value: character, attributes: {} })),
          ),
        ),
      );
    }
    result.push(
      ...createOccurrenceUnlessPresent(
        value.occurrenceId,
        value.nodeId,
        mutation.fieldNodeId,
        END,
        available,
      ),
    );
  }
  result.push(mutation);
  return result;
}

function expandTemplateDetachment(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  available: Projection,
): readonly Mutation[] {
  const source = available.nodes[mutation.templateNodeId];
  const instanceNodeId = templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId);
  const instanceOccurrenceId = templateInstanceOccurrenceId(
    mutation.ownerNodeId,
    mutation.templateNodeId,
  );
  const detachment = { ...mutation, instanceNodeId, instanceOccurrenceId };
  const seed = source
    ? nodeSeed(
        source.properties,
        source.metadata,
        {},
        source.text.map((atom) => ({ value: atom.value, attributes: atom.attributes })),
      )
    : undefined;
  return [
    ...createNodeUnlessPresent(instanceNodeId, available, seed),
    detachment,
    {
      kind: "occurrence-create",
      occurrenceId: instanceOccurrenceId,
      nodeId: instanceNodeId,
      parentNodeId: mutation.ownerNodeId,
      anchor: mutation.anchor,
    },
  ];
}

function createNodeUnlessPresent(
  nodeId: string,
  available: Projection,
  seed?: NodeSeed,
): readonly Mutation[] {
  return available.nodes[nodeId]
    ? []
    : [{ kind: "node-create", nodeId, ...(seed ? { seed } : {}) }];
}

function createOccurrenceUnlessPresent(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
  anchor: Extract<Mutation, { kind: "occurrence-create" }>["anchor"],
  available: Projection,
): readonly Mutation[] {
  return available.occurrences[occurrenceId]
    ? []
    : [{ kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor }];
}

function deletePlacement(occurrenceId: string, available: Projection): readonly Mutation[] {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    return [];
  }
  return available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? [
        { kind: "occurrence-delete", occurrenceId },
        ...deleteOwnedSubtree(occurrence.nodeId, available),
      ]
    : [{ kind: "occurrence-delete", occurrenceId }];
}

function nodeSeed(
  properties: Readonly<Record<string, JsonValue>>,
  metadata: Readonly<Record<string, JsonValue>>,
  additions: Readonly<Record<string, JsonValue>> = {},
  text: NodeSeed["text"] = [],
): NodeSeed {
  return { text, properties: { ...properties, ...additions }, metadata: { ...metadata } };
}
