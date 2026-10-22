import type { GraphAction } from "../../../src/domain/fact/index.js";

export function fixturePrerequisites(authoredAction: GraphAction): readonly GraphAction[] {
  if (authoredAction.kind === "field-materialize") {
    return [];
  }
  if (authoredAction.kind === "template-node-detach") {
    return [
      {
        kind: "node-create",
        nodeId: authoredAction.instanceNodeId,
        ownerNodeId: authoredAction.ownerNodeId,
        originalPlacement: null,
      },
    ];
  }
  return [];
}

export function fixtureConsequences(authoredAction: GraphAction): readonly GraphAction[] {
  if (authoredAction.kind === "template-node-detach") {
    return [
      {
        kind: "placement-create",
        placementId: authoredAction.instanceOccurrenceId,
        nodeId: authoredAction.instanceNodeId,
        parentNodeId: authoredAction.ownerNodeId,
        anchor: authoredAction.anchor,
      },
    ];
  }
  return [];
}
