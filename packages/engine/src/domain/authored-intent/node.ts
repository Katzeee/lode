import { graphActionKindsInFamily, type GraphAction, type GraphNodeAction } from "../fact/index.js";
import { metanodeHostNodeId, type ScopedProjection } from "../reconcile/index.js";
import { isPresentNodeOutsideTrash, nodeLocation } from "../reconcile/node-graph.js";
import type { AuthoredIntentContext, AuthoredIntentFamily } from "./policy.js";

const NODE_ACTION_KINDS = graphActionKindsInFamily("node");

export const nodeAuthoredIntent = {
  key: "node",
  actionKinds: NODE_ACTION_KINDS,
  validate: validateNodeAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof NODE_ACTION_KINDS)[number]>;

function validateNodeAuthoredIntent(action: GraphNodeAction, context: AuthoredIntentContext): GraphNodeAction {
  const { available, resulting } = context.projections();
  switch (action.kind) {
    case "workspace-bootstrap":
      if (action.workspaceNodeId !== available.identity.workspaceNodeId) {
        throw new Error("Workspace bootstrap identity does not match the Workspace");
      }
      return action;
    case "node-create":
      assertNodeCreationTarget(action, available, resulting);
      return action;
    case "node-trash":
      assertNodeDeletionTarget(action, available);
      return action;
    case "node-restore":
      assertNodeRestoreTarget(action, available);
      return action;
    case "original-promote":
      assertOriginalPromotionTarget(action, available);
      return action;
  }
}

function assertNodeCreationTarget(
  action: Extract<GraphAction, { kind: "node-create" }>,
  available: ScopedProjection,
  resulting: ScopedProjection,
): void {
  if (available.nodes[action.nodeId] !== undefined) {
    throw new Error("Node identity already exists");
  }
  if (action.nodeId === available.identity.workspaceNodeId) {
    throw new Error("Workspace Node is created only by Workspace bootstrap");
  }
  const metanodeHostId = metanodeHostNodeId(action.ownerNodeId);
  if (
    resulting.nodes[action.ownerNodeId] === undefined &&
    (metanodeHostId === null || resulting.nodes[metanodeHostId] === undefined)
  ) {
    throw new Error("Node Original parent is absent from the observed projection");
  }
  if (
    action.originalPlacement !== null &&
    available.occurrences[action.originalPlacement.placementId]?.derived === false
  ) {
    throw new Error("Node Original Placement identity already exists");
  }
}

function assertNodeDeletionTarget(
  action: Extract<GraphAction, { kind: "node-trash" }>,
  available: ScopedProjection,
): void {
  if (action.nodeId === available.identity.workspaceNodeId) {
    throw new Error("Workspace Node cannot be deleted");
  }
  if (belongsToSystemRole(action.nodeId, available)) {
    throw new Error("Workspace System Node cannot be deleted");
  }
  if (Object.values(available.metanodes).includes(action.nodeId)) {
    throw new Error("Metanode cannot be deleted independently of its host");
  }
  if (nodeLocation(available.identity.workspaceNodeId, available, action.nodeId) !== "active") {
    throw new Error(`Delete target Node does not exist: ${action.nodeId}`);
  }
}

function assertNodeRestoreTarget(
  action: Extract<GraphAction, { kind: "node-restore" }>,
  available: ScopedProjection,
): void {
  const occurrence = available.occurrences[action.placementId];
  if (
    nodeLocation(available.identity.workspaceNodeId, available, action.nodeId) !== "trash" ||
    occurrence?.nodeId !== action.nodeId ||
    !isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, action.parentNodeId)
  ) {
    throw new Error("Restore target or destination context is absent");
  }
}

function assertOriginalPromotionTarget(
  action: Extract<GraphAction, { kind: "original-promote" }>,
  available: ScopedProjection,
): void {
  const placement = available.occurrences[action.placementId];
  if (placement?.nodeId !== action.nodeId) {
    throw new Error("Original promotion target is absent from the observed projection");
  }
  assertOwnerAcyclic(action.nodeId, placement.parentNodeId, available);
}

function belongsToSystemRole(nodeId: string, projection: ScopedProjection): boolean {
  const protectedRoots = new Set(Object.values(projection.workspaceSystemNodes));
  let cursor: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (protectedRoots.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
  return false;
}

function assertOwnerAcyclic(nodeId: string, ownerNodeId: string, projection: ScopedProjection): void {
  let cursor: string | null | undefined = ownerNodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === nodeId || seen.has(cursor)) {
      throw new Error("Node ownership would form a cycle");
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
}
