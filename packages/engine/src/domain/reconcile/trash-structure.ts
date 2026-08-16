import { stableStringCompare, type ContributionFact } from "../fact/index.js";
import { nodeDeletionFactIds } from "../maintenance/index.js";
import type { MutableOccurrence } from "./projection-state.js";
import { insertAtAnchor, listFor, removePlacement } from "./sequence.js";
import { projectWorkspaceSystemNodes, type WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export type NodeGraphStructure = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  nodeOwners: Readonly<Record<string, string | null>>;
  workspaceSystemNodes: WorkspaceSystemNodes;
  metanodes: Readonly<Record<string, string>>;
}>;

export function placeDeletedNodesInTrash(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
): NodeGraphStructure {
  const effectiveOccurrences = new Map(
    [...occurrences].map(([occurrenceId, occurrence]) => [occurrenceId, { ...occurrence }]),
  );
  const effectiveChildren = new Map([...childOccurrences].map(([nodeId, ids]) => [nodeId, [...ids]]));
  const effectiveOwners = { ...nodeOwners };
  const workspaceSystemNodes = projectWorkspaceSystemNodes(workspaceNodeId, occurrences);
  const trashNodeId = workspaceSystemNodes.trash;
  if (!trashNodeId || !Object.hasOwn(nodeOwners, trashNodeId)) {
    return {
      occurrences: effectiveOccurrences,
      childOccurrences: effectiveChildren,
      nodeOwners: effectiveOwners,
      workspaceSystemNodes,
      metanodes,
    };
  }

  const deletedNodeIds = new Set(nodeDeletionFactIds(active).keys());
  const deletionRoots = [...deletedNodeIds]
    .filter((nodeId) => nodeId !== workspaceNodeId && nodeId !== trashNodeId)
    .filter((nodeId) => !ownerPathContains(nodeOwners, nodeOwners[nodeId], deletedNodeIds))
    .sort(stableStringCompare);

  for (const nodeId of deletionRoots) {
    const ownerNodeId = effectiveOwners[nodeId];
    if (ownerNodeId === null || ownerNodeId === undefined) {
      continue;
    }
    const original = [...effectiveOccurrences.values()].find(
      (occurrence) => occurrence.nodeId === nodeId && occurrence.parentNodeId === ownerNodeId,
    );
    if (!original) {
      continue;
    }
    if (ownerNodeId !== trashNodeId) {
      removePlacement(effectiveChildren, original.occurrenceId);
      original.parentNodeId = trashNodeId;
      insertAtAnchor(listFor(effectiveChildren, trashNodeId), original.occurrenceId, {
        after: null,
        before: null,
        affinity: "after",
        fallback: "end",
      });
      effectiveOwners[nodeId] = trashNodeId;
    }
  }
  return {
    occurrences: effectiveOccurrences,
    childOccurrences: effectiveChildren,
    nodeOwners: effectiveOwners,
    workspaceSystemNodes,
    metanodes,
  };
}

function ownerPathContains(
  nodeOwners: Readonly<Record<string, string | null>>,
  start: string | null | undefined,
  candidates: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let cursor = start;
  while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
    if (candidates.has(cursor)) {
      return true;
    }
    visited.add(cursor);
    cursor = nodeOwners[cursor];
  }
  return false;
}
