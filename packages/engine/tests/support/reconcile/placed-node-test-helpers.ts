import {
  fieldDefinitionEndpointOccurrenceId,
  type Fact,
  type Mutation,
  type IntrinsicNodeType,
} from "../../../src/domain/fact/index.js";

type PlacedNodeFacts = Readonly<{
  add(mutation: Mutation, intent?: "direct" | "proposal"): Fact;
  addTransaction(mutations: readonly Mutation[], intent?: "direct" | "proposal"): readonly Fact[];
}>;

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function withInitialOwnerRelations(mutations: readonly Mutation[]): readonly Mutation[] {
  const explicit = new Set(
    mutations.flatMap((mutation) =>
      mutation.kind === "node-owner-set" && mutation.previousOwnerNodeId === null ? [mutation.nodeId] : [],
    ),
  );
  return mutations.flatMap((mutation): readonly Mutation[] => {
    if (mutation.kind !== "node-create" || explicit.has(mutation.nodeId)) {
      return [mutation];
    }
    const metanodeHost = mutations.find(
      (candidate) => candidate.kind === "metanode-attach" && candidate.metanodeId === mutation.nodeId,
    );
    const placement = mutations.find(
      (candidate) => candidate.kind === "occurrence-create" && candidate.nodeId === mutation.nodeId,
    );
    const ownerNodeId =
      metanodeHost?.kind === "metanode-attach"
        ? metanodeHost.hostNodeId
        : placement?.kind === "occurrence-create"
          ? placement.parentNodeId
          : null;
    return ownerNodeId === null
      ? [mutation]
      : [mutation, { kind: "node-owner-set", nodeId: mutation.nodeId, ownerNodeId, previousOwnerNodeId: null }];
  });
}

export function withFieldDefinitionEndpoints(mutations: readonly Mutation[]): readonly Mutation[] {
  const explicitOccurrences = new Set(
    mutations.flatMap((mutation) => (mutation.kind === "occurrence-create" ? [mutation.occurrenceId] : [])),
  );
  return mutations.flatMap((mutation): readonly Mutation[] => {
    if (mutation.kind !== "field-materialize") {
      return [mutation];
    }
    const occurrenceId = fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId);
    return explicitOccurrences.has(occurrenceId)
      ? [mutation]
      : [
          {
            kind: "occurrence-create",
            occurrenceId,
            nodeId: mutation.fieldDefinitionId,
            parentNodeId: mutation.fieldNodeId,
            anchor: { after: null, before: null, affinity: "before", fallback: "start" },
          },
          mutation,
        ];
  });
}

export function addPlacedNode(
  facts: PlacedNodeFacts,
  nodeId: string,
  intent: "direct" | "proposal" = "direct",
  parentNodeId = "workspace",
  occurrenceId = `${nodeId}-original`,
): void {
  facts.addTransaction(
    withInitialOwnerRelations([
      { kind: "node-create", nodeId },
      { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
    ]),
    intent,
  );
}

export function addDefinitionNode(
  facts: PlacedNodeFacts,
  nodeId: string,
  intrinsicNodeType: IntrinsicNodeType,
  intent: "direct" | "proposal" = "direct",
): void {
  addPlacedNode(facts, nodeId, intent);
  facts.add({ kind: "intrinsic-node-type-declare", nodeId, intrinsicNodeType }, intent);
}
