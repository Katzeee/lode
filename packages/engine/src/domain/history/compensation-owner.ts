import { compareCausalOrder, type FactAction } from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep, type CompensationTargetAction } from "./compensation-types.js";

export function compensateNodeOwner(
  target: FactAction<Extract<CompensationTargetAction, { kind: "original-promote" }>>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  const winner = activeFacts
    .filter(
      (fact) =>
        (fact.action.kind === "node-create" ||
          fact.action.kind === "original-promote" ||
          fact.action.kind === "node-restore") &&
        fact.action.nodeId === authoredAction.nodeId,
    )
    .sort(compareCausalOrder)
    .at(-1);
  const selected = projection.occurrences[authoredAction.placementId];
  if (winner?.id !== target.id || selected?.nodeId !== authoredAction.nodeId) {
    return noCompensation();
  }
  const previousSelection = activeFacts
    .filter(
      (fact) =>
        fact.id !== target.id &&
        (fact.action.kind === "node-create" ||
          fact.action.kind === "original-promote" ||
          fact.action.kind === "node-restore") &&
        fact.action.nodeId === authoredAction.nodeId,
    )
    .sort(compareCausalOrder)
    .at(-1);
  const previousPlacementId =
    previousSelection?.action.kind === "node-create"
      ? previousSelection.action.originalPlacement?.placementId
      : previousSelection?.action.kind === "original-promote" || previousSelection?.action.kind === "node-restore"
        ? previousSelection.action.placementId
        : Object.values(counterfactual.occurrences).find(
            (occurrence) =>
              occurrence.nodeId === authoredAction.nodeId &&
              occurrence.parentNodeId === counterfactual.nodeOwners[authoredAction.nodeId],
          )?.occurrenceId;
  if (
    previousPlacementId === undefined ||
    projection.occurrences[previousPlacementId]?.nodeId !== authoredAction.nodeId
  ) {
    return { kind: "stale", reason: "Previous Original placement is no longer valid" };
  }
  return {
    kind: "ready",
    actions: [{ kind: "original-promote", nodeId: authoredAction.nodeId, placementId: previousPlacementId }],
  };
}
