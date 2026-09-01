import { graphActionKindsInFamily, type GraphAction, type GraphNodeAction } from "../fact/index.js";
import { isActiveNode, metanodeHostNodeId, nodeLocation, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentContext, type AuthoredIntentFamily } from "./contract.js";

const NODE_ACTION_KINDS = graphActionKindsInFamily("node");

export const nodeAuthoredIntent = {
  key: "node",
  actionKinds: NODE_ACTION_KINDS,
  assert: assertNodeAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof NODE_ACTION_KINDS)[number]>;

function assertNodeAuthoredIntent(action: GraphNodeAction, context: AuthoredIntentContext): void {
  const { available, resulting } = context;
  switch (action.kind) {
    case "workspace-bootstrap":
      if (action.workspaceNodeId !== available.identity.workspaceNodeId) {
        throw new AuthoredIntentViolation("Workspace bootstrap identity does not match the Workspace");
      }
      return;
    case "node-create":
      assertNodeCreationTarget(action, available, resulting);
      return;
    case "node-trash":
      assertNodeDeletionTarget(action, available);
      return;
    case "node-restore":
      assertNodeRestoreTarget(action, available);
      return;
    case "original-promote":
      assertOriginalPromotionTarget(action, available);
      return;
    default:
      action satisfies never;
  }
}

function assertNodeCreationTarget(
  action: Extract<GraphAction, { kind: "node-create" }>,
  available: InterpretedProjection,
  resulting: InterpretedProjection,
): void {
  if (action.nodeId === available.identity.workspaceNodeId) {
    throw new AuthoredIntentViolation("Workspace Node is created only by Workspace bootstrap");
  }
  if (available.nodes[action.nodeId] !== undefined) {
    throw new AuthoredIntentViolation("Node identity already exists");
  }
  const ownerLocation = nodeLocation(resulting.identity.workspaceNodeId, resulting, action.ownerNodeId);
  const metanodeHostId = metanodeHostNodeId(action.ownerNodeId);
  const metanodeHostLocation =
    metanodeHostId === null ? null : nodeLocation(resulting.identity.workspaceNodeId, resulting, metanodeHostId);
  if (ownerLocation !== "active" && metanodeHostLocation !== "active") {
    throw new AuthoredIntentViolation("Node Original parent is absent from the observed projection");
  }
  if (
    action.originalPlacement !== null &&
    available.occurrences[action.originalPlacement.placementId]?.derived === false
  ) {
    throw new AuthoredIntentViolation("Node Original Placement identity already exists");
  }
}

function assertNodeDeletionTarget(
  action: Extract<GraphAction, { kind: "node-trash" }>,
  available: InterpretedProjection,
): void {
  if (action.nodeId === available.identity.workspaceNodeId) {
    throw new AuthoredIntentViolation("Workspace Node cannot be deleted");
  }
  if (belongsToSystemRole(action.nodeId, available)) {
    throw new AuthoredIntentViolation("Workspace System Node cannot be deleted");
  }
  if (Object.values(available.metanodes).includes(action.nodeId)) {
    throw new AuthoredIntentViolation("Metanode cannot be deleted independently of its host");
  }
  if (nodeLocation(available.identity.workspaceNodeId, available, action.nodeId) !== "active") {
    throw new AuthoredIntentViolation(`Delete target Node does not exist: ${action.nodeId}`);
  }
}

function assertNodeRestoreTarget(
  action: Extract<GraphAction, { kind: "node-restore" }>,
  available: InterpretedProjection,
): void {
  const occurrence = available.occurrences[action.placementId];
  if (
    nodeLocation(available.identity.workspaceNodeId, available, action.nodeId) !== "trash" ||
    occurrence?.nodeId !== action.nodeId ||
    !isActiveNode(available.identity.workspaceNodeId, available, action.parentNodeId)
  ) {
    throw new AuthoredIntentViolation("Restore target or destination context is absent");
  }
}

function assertOriginalPromotionTarget(
  action: Extract<GraphAction, { kind: "original-promote" }>,
  available: InterpretedProjection,
): void {
  const placement = available.occurrences[action.placementId];
  if (placement?.nodeId !== action.nodeId) {
    throw new AuthoredIntentViolation("Original promotion target is absent from the observed projection");
  }
  assertOwnerAcyclic(action.nodeId, placement.parentNodeId, available);
}

function belongsToSystemRole(nodeId: string, projection: InterpretedProjection): boolean {
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

function assertOwnerAcyclic(nodeId: string, ownerNodeId: string, projection: InterpretedProjection): void {
  let cursor: string | null | undefined = ownerNodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === nodeId || seen.has(cursor)) {
      throw new AuthoredIntentViolation("Node ownership would form a cycle");
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
}
