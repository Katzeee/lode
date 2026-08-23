import type { TrashEvidenceQueryRequest, TrashEvidenceResult } from "@lode/sdk";
import { factActionsFromFacts, type FactSnapshot } from "../../../domain/fact/index.js";
import { nodeDeletionActionIds } from "../../../domain/maintenance/index.js";
import {
  nodeLocation,
  occurrenceAnchor,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../../domain/reconcile/index.js";

export function queryTrashEvidence(
  query: TrashEvidenceQueryRequest,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
): TrashEvidenceResult {
  const projection = generation[query.perspective];
  const unavailable: TrashEvidenceResult = {
    generationId: generation.identity.generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    nodeId: query.nodeId,
    available: false,
    occurrenceId: "",
    parentNodeId: "",
    anchor: null,
  };
  if (nodeLocation(projection.identity.workspaceNodeId, projection, query.nodeId) !== "trash") {
    return unavailable;
  }

  const activeIds = new Set(generation.planCaches[query.perspective].activeActionIds);
  const active = factActionsFromFacts(snapshot.facts).filter((action) => activeIds.has(action.id));
  const trashActionIds = new Set(nodeDeletionActionIds(active).get(query.nodeId) ?? []);
  const trashFactIds = new Set(active.filter((action) => trashActionIds.has(action.id)).map((action) => action.factId));
  const facts = snapshot.facts.filter((fact) => !trashFactIds.has(fact.id));
  const beforeTrash = rebuildGeneration(
    projection.identity.workspaceNodeId,
    { facts, frontier: snapshot.frontier },
    { rulesVersion: projection.identity.rulesVersion, schemaVersion: projection.identity.schemaVersion },
  )[query.perspective];
  const parentNodeId = beforeTrash.nodeOwners[query.nodeId];
  const occurrence = Object.values(beforeTrash.occurrences).find(
    (candidate) => candidate.nodeId === query.nodeId && candidate.parentNodeId === parentNodeId,
  );
  if (parentNodeId == null || occurrence === undefined) {
    return unavailable;
  }
  return {
    ...unavailable,
    available: true,
    occurrenceId: occurrence.occurrenceId,
    parentNodeId,
    anchor: occurrenceAnchor(beforeTrash, occurrence.occurrenceId),
  };
}
