import type { FactAction } from "../fact/index.js";
import { nodeDeletionActionIds } from "./deletion-finalization.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { insertAtAnchor, listFor, removePlacement } from "./sequence.js";
import { projectWorkspaceSystemNodes, type WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import { projectNodeOwnership, type OriginalSelection } from "./node-ownership.js";

export type NodeGraphStructure = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  nodeOwners: Readonly<Record<string, string | null>>;
  workspaceSystemNodes: WorkspaceSystemNodes;
  metanodes: Readonly<Record<string, string>>;
}>;

export function projectNodeGraphStructure(
  workspaceNodeId: string,
  active: readonly FactAction[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
  metanodes: Readonly<Record<string, string>>,
): NodeGraphStructure {
  const effectiveOccurrences = new Map(
    [...occurrences].map(([occurrenceId, occurrence]) => [occurrenceId, { ...occurrence }]),
  );
  const effectiveChildren = new Map([...childOccurrences].map(([nodeId, ids]) => [nodeId, [...ids]]));
  const ownership = projectNodeOwnership(workspaceNodeId, active, nodes, effectiveOccurrences);
  const effectiveOwners = { ...ownership.nodeOwners };
  const workspaceSystemNodes = projectWorkspaceSystemNodes(workspaceNodeId, occurrences, ownership.nodeOwners);
  applyNodeLifecycle(
    active,
    effectiveOccurrences,
    effectiveChildren,
    effectiveOwners,
    ownership.originals,
    workspaceSystemNodes.trash,
  );
  return {
    occurrences: effectiveOccurrences,
    childOccurrences: effectiveChildren,
    nodeOwners: effectiveOwners,
    workspaceSystemNodes,
    metanodes,
  };
}

function applyNodeLifecycle(
  active: readonly FactAction[],
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
  nodeOwners: Record<string, string | null>,
  originals: Readonly<Record<string, OriginalSelection>>,
  trashNodeId: string | undefined,
): void {
  const liveTrash = nodeDeletionActionIds(active);
  for (const nodeId of new Set([...liveTrash.keys(), ...Object.keys(originals)])) {
    const original = originals[nodeId];
    const restore = original?.action;
    if (restore?.action.kind === "node-restore") {
      movePlacement(
        occurrences,
        childOccurrences,
        restore.action.placementId,
        nodeId,
        restore.action.parentNodeId,
        restore.action.anchor,
      );
    }

    const selectedPlacementId = original?.placementId;
    if (selectedPlacementId === undefined) {
      continue;
    }
    if (liveTrash.has(nodeId) && trashNodeId !== undefined) {
      movePlacement(occurrences, childOccurrences, selectedPlacementId, nodeId, trashNodeId, {
        after: null,
        before: null,
        affinity: "after",
        fallback: "end",
      });
    }
    const selectedPlacement = occurrences.get(selectedPlacementId);
    if (selectedPlacement?.nodeId === nodeId && liveTrash.has(nodeId) && trashNodeId !== undefined) {
      nodeOwners[nodeId] = trashNodeId;
    }
  }
}

function movePlacement(
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
  placementId: string,
  nodeId: string,
  parentNodeId: string,
  anchor: Parameters<typeof insertAtAnchor>[2],
): void {
  const placement = occurrences.get(placementId);
  if (placement?.nodeId !== nodeId) {
    return;
  }
  removePlacement(childOccurrences, placementId);
  placement.parentNodeId = parentNodeId;
  insertAtAnchor(listFor(childOccurrences, parentNodeId), placementId, anchor);
}
