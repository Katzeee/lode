import {
  graphActionKindsInFamily,
  workspaceTrashOccurrenceId,
  type AuthoredAction,
  type PlacementAction,
} from "../fact/index.js";
import { isActiveNode, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentContext, type AuthoredIntentFamily } from "./contract.js";

type MutablePlacementAction = Extract<AuthoredAction, { kind: "placement-move" | "placement-remove" }>;

const PLACEMENT_ACTION_KINDS = graphActionKindsInFamily("placement");

export const placementAuthoredIntent = {
  key: "placement",
  actionKinds: PLACEMENT_ACTION_KINDS,
  assert: assertPlacementAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof PLACEMENT_ACTION_KINDS)[number]>;

function assertPlacementAuthoredIntent(action: PlacementAction, context: AuthoredIntentContext): void {
  const { available, resulting } = context;
  switch (action.kind) {
    case "placement-create":
      assertPlacementCreate(action, available, resulting);
      return;
    case "placement-remove":
    case "placement-move": {
      assertMutableOccurrence(action, available, resulting);
      return;
    }
    default:
      action satisfies never;
  }
}

function assertPlacementCreate(
  action: Extract<AuthoredAction, { kind: "placement-create" }>,
  available: InterpretedProjection,
  resulting: InterpretedProjection,
): void {
  if (!isActiveNode(resulting.identity.workspaceNodeId, resulting, action.nodeId)) {
    throw new AuthoredIntentViolation("Occurrence Node is absent from the observed projection");
  }
  assertPlacementParent(resulting, action.parentNodeId);
  const existing = available.occurrences[action.placementId];
  if (existing && (existing.nodeId !== action.nodeId || existing.parentNodeId !== action.parentNodeId)) {
    throw new AuthoredIntentViolation("Occurrence identity already names another placement");
  }
  assertUniquePlacement(resulting, action.nodeId, action.parentNodeId, action.placementId);
}

function assertMutableOccurrence(
  action: MutablePlacementAction,
  available: InterpretedProjection,
  resulting: InterpretedProjection,
): void {
  if (action.placementId === workspaceTrashOccurrenceId(available.identity.workspaceNodeId)) {
    throw new AuthoredIntentViolation("Workspace Trash role cannot be moved or deleted");
  }
  const occurrence = available.occurrences[action.placementId];
  if (!occurrence) {
    throw new AuthoredIntentViolation("Occurrence target is absent from the observed projection");
  }
  if (action.kind === "placement-move") {
    assertPlacementParent(resulting, action.parentNodeId);
    assertUniquePlacement(resulting, occurrence.nodeId, action.parentNodeId, action.placementId);
  }
}

function assertPlacementParent(projection: InterpretedProjection, parentNodeId: string): void {
  if (!isActiveNode(projection.identity.workspaceNodeId, projection, parentNodeId)) {
    throw new AuthoredIntentViolation("Parent Node is absent from the observed projection");
  }
}

function assertUniquePlacement(
  projection: InterpretedProjection,
  nodeId: string,
  parentNodeId: string,
  excludedOccurrenceId?: string,
): void {
  if (
    Object.values(projection.occurrences).some(
      (occurrence) =>
        occurrence.occurrenceId !== excludedOccurrenceId &&
        occurrence.nodeId === nodeId &&
        occurrence.parentNodeId === parentNodeId,
    )
  ) {
    throw new AuthoredIntentViolation("A Node cannot appear twice in one parent Node childOccurrences list");
  }
}
