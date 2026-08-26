import {
  fieldDefinitionEndpointOccurrenceId,
  type FactAction,
  type GraphAction,
  type IntrinsicNodeType,
} from "../../../src/domain/fact/index.js";

type PlacedNodeFacts = Readonly<{
  add(authoredAction: GraphAction, intent?: "direct" | "proposal"): FactAction;
  addTransaction(actions: readonly GraphAction[], intent?: "direct" | "proposal"): readonly FactAction[];
}>;

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function withInitialNodeRelations(actions: readonly GraphAction[]): readonly GraphAction[] {
  const initialPlacements = new Map(
    actions.flatMap((authoredAction) =>
      authoredAction.kind === "placement-create" ? [[authoredAction.nodeId, authoredAction] as const] : [],
    ),
  );
  const foldedPlacementIds = new Set<string>();
  const folded = actions.map((authoredAction): GraphAction => {
    if (authoredAction.kind !== "node-create" || authoredAction.originalPlacement !== null) {
      return authoredAction;
    }
    const placement = initialPlacements.get(authoredAction.nodeId);
    const ownerNodeId = placement?.kind === "placement-create" ? placement.parentNodeId : authoredAction.ownerNodeId;
    if (placement) {
      foldedPlacementIds.add(placement.placementId);
    }
    return {
      ...authoredAction,
      ownerNodeId,
      originalPlacement: placement ? { placementId: placement.placementId, anchor: placement.anchor } : null,
    };
  });
  return folded.filter(
    (authoredAction) =>
      authoredAction.kind !== "placement-create" || !foldedPlacementIds.has(authoredAction.placementId),
  );
}

export function withFieldDefinitionEndpoints(actions: readonly GraphAction[]): readonly GraphAction[] {
  const explicitOccurrences = new Set(
    actions.flatMap((authoredAction) =>
      authoredAction.kind === "placement-create" ? [authoredAction.placementId] : [],
    ),
  );
  return actions.flatMap((authoredAction): readonly GraphAction[] => {
    if (authoredAction.kind !== "field-materialize") {
      return [authoredAction];
    }
    const occurrenceId = fieldDefinitionEndpointOccurrenceId(authoredAction.fieldOccurrenceId);
    return explicitOccurrences.has(occurrenceId)
      ? [authoredAction]
      : [
          {
            kind: "placement-create",
            placementId: occurrenceId,
            nodeId: authoredAction.fieldDefinitionId,
            parentNodeId: authoredAction.fieldNodeId,
            anchor: { after: null, before: null, affinity: "before", fallback: "start" },
          },
          authoredAction,
        ];
  });
}

export function addPlacedNode(
  facts: PlacedNodeFacts,
  nodeId: string,
  intent: "direct" | "proposal" = "direct",
  parentNodeId = "workspace",
  occurrenceId = `${nodeId}-original`,
  intrinsicNodeType?: IntrinsicNodeType,
): void {
  facts.addTransaction(
    withInitialNodeRelations([
      {
        kind: "node-create",
        nodeId,
        ownerNodeId: parentNodeId,
        originalPlacement: null,
        ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType }),
      },
      { kind: "placement-create", placementId: occurrenceId, nodeId, parentNodeId, anchor: end },
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
  facts.add(
    {
      kind: "node-create",
      nodeId,
      ownerNodeId: "workspace",
      originalPlacement: { placementId: `${nodeId}-original`, anchor: end },
      intrinsicNodeType,
    },
    intent,
  );
}
