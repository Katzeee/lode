import { compareCausalOrder, stableStringCompare, type FactAction } from "../fact/index.js";
import type { MutableNode } from "./projection-state.js";
import type { MutableOccurrence } from "./projection-state.js";
import { projectSemanticNodeOwners } from "./semantic-node-ownership.js";

type NodeOwnership = Readonly<{
  nodeOwners: Readonly<Record<string, string | null>>;
  originals: Readonly<Record<string, OriginalSelection>>;
}>;

export type OriginalSelection = Readonly<{ placementId: string; action: FactAction }>;

export function projectNodeOwnership(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): NodeOwnership {
  if (!nodes.has(workspaceNodeId)) {
    return { nodeOwners: {}, originals: {} };
  }

  const owners = projectSemanticNodeOwners(workspaceNodeId, active, nodes);
  const originals = new Map<string, OriginalSelection>();
  const candidates = new Map<string, FactAction[]>();
  for (const action of active) {
    const nodeId = ownershipNodeId(action);
    if (nodeId !== null && nodeId !== workspaceNodeId && nodes.has(nodeId)) {
      const values = candidates.get(nodeId) ?? [];
      values.push(action);
      candidates.set(nodeId, values);
    }
  }
  for (const [nodeId, actions] of [...candidates].sort(([left], [right]) => stableStringCompare(left, right))) {
    let ownerSelected = false;
    let originalSelected = false;
    for (const candidate of [...actions].sort(compareCausalOrder).reverse()) {
      const selection = ownershipSelection(candidate, occurrences);
      if (selection === undefined) {
        continue;
      }
      const ownerIsValid =
        (selection.ownerNodeId === null || nodes.has(selection.ownerNodeId)) &&
        !createsOwnerCycle(nodeId, selection.ownerNodeId, owners);
      if (!ownerSelected && ownerIsValid) {
        owners.set(nodeId, selection.ownerNodeId);
        ownerSelected = true;
      }
      if (!originalSelected && selection.definesOriginal && ownerIsValid) {
        originalSelected = true;
        if (selection.originalPlacementId !== undefined) {
          originals.set(nodeId, { placementId: selection.originalPlacementId, action: candidate });
        }
      }
      if (ownerSelected && originalSelected) {
        break;
      }
    }
  }

  return {
    nodeOwners: Object.fromEntries([...owners].sort(([left], [right]) => stableStringCompare(left, right))),
    originals: Object.fromEntries([...originals].sort(([left], [right]) => stableStringCompare(left, right))),
  };
}

function ownershipNodeId(action: FactAction): string | null {
  const authoredAction = action.action;
  if (
    authoredAction.kind === "node-create" ||
    authoredAction.kind === "node-restore" ||
    authoredAction.kind === "original-promote"
  ) {
    return authoredAction.nodeId;
  }
  return null;
}

function ownershipSelection(
  action: FactAction,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): Readonly<{ ownerNodeId: string | null; originalPlacementId?: string; definesOriginal: boolean }> | undefined {
  const authoredAction = action.action;
  if (authoredAction.kind === "node-create") {
    if (authoredAction.originalPlacement === null) {
      return { ownerNodeId: authoredAction.ownerNodeId, definesOriginal: true };
    }
    const placementId = authoredAction.originalPlacement.placementId;
    const placement = occurrences.get(placementId);
    return placement?.nodeId === authoredAction.nodeId
      ? { ownerNodeId: placement.parentNodeId, originalPlacementId: placementId, definesOriginal: true }
      : undefined;
  }
  if (authoredAction.kind === "node-restore") {
    return occurrences.get(authoredAction.placementId)?.nodeId === authoredAction.nodeId
      ? {
          ownerNodeId: authoredAction.parentNodeId,
          originalPlacementId: authoredAction.placementId,
          definesOriginal: true,
        }
      : undefined;
  }
  if (authoredAction.kind === "original-promote") {
    const placement = occurrences.get(authoredAction.placementId);
    return placement?.nodeId === authoredAction.nodeId
      ? { ownerNodeId: placement.parentNodeId, originalPlacementId: authoredAction.placementId, definesOriginal: true }
      : undefined;
  }
  return undefined;
}

function createsOwnerCycle(
  nodeId: string,
  ownerNodeId: string | null,
  owners: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>([nodeId]);
  let cursor: string | null | undefined = ownerNodeId;
  while (cursor !== null && cursor !== undefined) {
    if (visited.has(cursor)) {
      return true;
    }
    visited.add(cursor);
    cursor = owners.get(cursor);
  }
  return false;
}
