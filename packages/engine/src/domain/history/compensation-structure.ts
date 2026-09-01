import {
  compareCausalOrder,
  fieldDefinitionEndpointOccurrenceId,
  type GraphAction,
  type FactAction,
} from "../fact/index.js";
import { nodeLocation, occurrenceAnchor, type InterpretedProjection } from "../reconcile/index.js";
import { deriveSupport } from "../activation/index.js";
import { hasAlternateNodeCreator, hasIndependentOccurrenceWork } from "./compensation-lifecycle.js";
import { compensateNodeOwner } from "./compensation-owner.js";
import {
  noCompensation,
  type CompensationCatalog,
  type CompensationStep,
  type CompensationTargetAction,
} from "./compensation-types.js";

export const STRUCTURE_COMPENSATIONS = {
  "node-create": ({ targetIds, activeFacts, projection }, target) =>
    compensateNodeCreate(target, targetIds, activeFacts, projection),
  "node-restore": ({ targetIds, activeFacts, projection }, target) =>
    compensateNodeCreate(target, targetIds, activeFacts, projection),
  "node-trash": ({ targetIds, activeFacts, projection, counterfactual }, target) =>
    compensateNodeTrash(target, targetIds, activeFacts, projection, counterfactual),
  "original-promote": ({ activeFacts, projection, counterfactual }, target) =>
    compensateNodeOwner(target, activeFacts, projection, counterfactual),
  "placement-create": ({ targetIds, activeFacts, projection }, target) =>
    compensateOccurrenceCreate(target, targetIds, activeFacts, projection),
  "placement-remove": ({ projection, counterfactual }, { action }) =>
    compensateOccurrenceDelete(action.placementId, projection, counterfactual),
  "placement-move": ({ activeFacts, projection, counterfactual }, target) =>
    compensateMove(target, activeFacts, projection, counterfactual),
  "field-value-remove": ({ projection, counterfactual }, { action }) =>
    compensateOccurrenceDelete(action.valuePlacementId, projection, counterfactual),
  "materialized-field-clear": ({ projection, counterfactual }, { action }) =>
    compensateMaterializedFieldClear(action, projection, counterfactual),
} satisfies Partial<CompensationCatalog>;

function compensateNodeCreate(
  target: FactAction<Extract<CompensationTargetAction, { kind: "node-create" | "node-restore" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  const location = nodeLocation(projection.identity.workspaceNodeId, projection, authoredAction.nodeId);
  const ownedByDetachedRelation = location === "absent" && projection.nodeOwners[authoredAction.nodeId] != null;
  if (location !== "active" && !ownedByDetachedRelation) {
    return noCompensation();
  }
  if (hasAlternateNodeCreator(target, targetIds, activeFacts)) {
    return noCompensation();
  }
  const reverseDependencies = [...deriveSupport(activeFacts)].filter(
    ([id, supports]) => !targetIds.has(id) && supports.includes(target.id),
  );
  if (reverseDependencies.length > 0) {
    return { kind: "stale", reason: "Deleting the created Node would remove later work" };
  }
  return { kind: "ready", actions: [{ kind: "node-trash", nodeId: authoredAction.nodeId }] };
}

function compensateNodeTrash(
  target: FactAction<Extract<CompensationTargetAction, { kind: "node-trash" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  if (nodeLocation(projection.identity.workspaceNodeId, projection, authoredAction.nodeId) !== "trash") {
    return noCompensation();
  }
  const independentDelete = activeFacts.some(
    (fact) =>
      !targetIds.has(fact.id) &&
      fact.action.kind === "node-trash" &&
      fact.action.nodeId === authoredAction.nodeId &&
      !activeFacts.some(
        (restore) => restore.action.kind === "node-restore" && restore.action.nodeId === authoredAction.nodeId,
      ),
  );
  const ownerNodeId = counterfactual.nodeOwners[authoredAction.nodeId];
  const occurrence = Object.values(counterfactual.occurrences).find(
    (candidate) => candidate.nodeId === authoredAction.nodeId && candidate.parentNodeId === ownerNodeId,
  );
  return independentDelete
    ? { kind: "stale", reason: "Node has an independent uncompensated deletion" }
    : ownerNodeId == null || occurrence === undefined
      ? { kind: "stale", reason: "Node has no restorable Original Occurrence" }
      : {
          kind: "ready",
          actions: [
            {
              kind: "node-restore",
              nodeId: authoredAction.nodeId,
              placementId: occurrence.occurrenceId,
              parentNodeId: ownerNodeId,
              anchor: occurrenceAnchor(counterfactual, occurrence.occurrenceId),
            },
          ],
        };
}

function compensateOccurrenceCreate(
  target: FactAction<Extract<CompensationTargetAction, { kind: "placement-create" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  if (
    !projection.occurrences[authoredAction.placementId] ||
    hasIndependentOccurrenceWork(target, targetIds, activeFacts) ||
    activeFacts.some(
      (fact) =>
        targetIds.has(fact.id) && fact.action.kind === "node-create" && fact.action.nodeId === authoredAction.nodeId,
    )
  ) {
    return noCompensation();
  }
  return {
    kind: "ready",
    actions: [
      {
        kind: "placement-remove",
        placementId: authoredAction.placementId,
      },
    ],
  };
}

function compensateOccurrenceDelete(
  occurrenceId: string,
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  if (projection.occurrences[occurrenceId]) {
    return noCompensation();
  }
  const previous = counterfactual.occurrences[occurrenceId];
  if (previous === undefined) {
    return { kind: "stale", reason: "Occurrence deletion cannot be safely restored" };
  }
  if (!projection.nodes[previous.parentNodeId]) {
    return { kind: "stale", reason: "Occurrence deletion previous parent no longer exists" };
  }
  return {
    kind: "ready",
    actions: [
      {
        kind: "placement-create",
        placementId: occurrenceId,
        nodeId: previous.nodeId,
        parentNodeId: previous.parentNodeId,
        anchor: occurrenceAnchor(counterfactual, occurrenceId),
      },
    ],
  };
}

function compensateMaterializedFieldClear(
  action: Extract<CompensationTargetAction, { kind: "materialized-field-clear" }>,
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const previousOccurrenceIds = materializedFieldOccurrenceIds(
    counterfactual,
    action.ownerNodeId,
    action.fieldDefinitionId,
  );
  const missingOccurrenceIds = previousOccurrenceIds.filter((occurrenceId) => !projection.occurrences[occurrenceId]);
  if (missingOccurrenceIds.length === 0) {
    return noCompensation();
  }
  const actions: GraphAction[] = [];
  for (const occurrenceId of missingOccurrenceIds) {
    const previous = counterfactual.occurrences[occurrenceId];
    if (!previous || !projection.nodes[previous.parentNodeId]) {
      return { kind: "stale", reason: "Materialized Field cannot be safely restored" };
    }
    actions.push({
      kind: "placement-create",
      placementId: occurrenceId,
      nodeId: previous.nodeId,
      parentNodeId: previous.parentNodeId,
      anchor: occurrenceAnchor(counterfactual, occurrenceId),
    });
  }
  return { kind: "ready", actions };
}

function materializedFieldOccurrenceIds(
  projection: InterpretedProjection,
  ownerNodeId: string,
  fieldDefinitionId: string,
): readonly string[] {
  return Object.values(projection.occurrences)
    .filter((occurrence) => {
      if (occurrence.parentNodeId !== ownerNodeId) {
        return false;
      }
      const endpoint = projection.occurrences[fieldDefinitionEndpointOccurrenceId(occurrence.occurrenceId)];
      return endpoint?.nodeId === fieldDefinitionId && endpoint.parentNodeId === occurrence.nodeId;
    })
    .map((occurrence) => occurrence.occurrenceId);
}

function compensateMove(
  target: FactAction<Extract<CompensationTargetAction, { kind: "placement-move" }>>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  const occurrence = projection.occurrences[authoredAction.placementId];
  const laterRestore = activeFacts.some(
    (fact) =>
      compareCausalOrder(target, fact) < 0 &&
      fact.action.kind === "placement-create" &&
      fact.action.placementId === authoredAction.placementId,
  );
  if (laterRestore) {
    return noCompensation();
  }
  const winner = activeFacts
    .filter(
      (fact) =>
        fact.action.kind === "placement-move" &&
        fact.action.placementId === authoredAction.placementId &&
        fact.action.parentNodeId === occurrence?.parentNodeId,
    )
    .sort(compareCausalOrder)
    .at(-1);
  if (winner?.id !== target.id || !occurrence || occurrence.parentNodeId !== authoredAction.parentNodeId) {
    return noCompensation();
  }
  const previous = counterfactual.occurrences[authoredAction.placementId];
  if (!previous || !projection.nodes[previous.parentNodeId]) {
    return { kind: "stale", reason: "Move previous parent no longer exists" };
  }
  return {
    kind: "ready",
    actions: [
      {
        kind: "placement-move",
        placementId: authoredAction.placementId,
        parentNodeId: previous.parentNodeId,
        anchor: occurrenceAnchor(counterfactual, authoredAction.placementId),
      },
    ],
  };
}
