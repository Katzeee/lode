import { workspaceTrashOccurrenceId, type AuthoredAction, type PlacementAction } from "../fact/index.js";
import { isPresentNodeOutsideTrash, type ScopedProjection } from "../reconcile/index.js";
import type { AuthoredIntentContext, AuthoredIntentFamily } from "./policy.js";

type MutablePlacementAction = Extract<AuthoredAction, { kind: "placement-move" | "placement-remove" }>;

const PLACEMENT_ACTION_KINDS = [
  "placement-create",
  "placement-remove",
  "placement-move",
] as const satisfies readonly PlacementAction["kind"][];

export const placementAuthoredIntent = {
  key: "placement",
  actionKinds: PLACEMENT_ACTION_KINDS,
  validate: validatePlacementAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof PLACEMENT_ACTION_KINDS)[number]>;

function validatePlacementAuthoredIntent(action: PlacementAction, context: AuthoredIntentContext): PlacementAction {
  const { available, resulting } = context.projections();
  switch (action.kind) {
    case "placement-create":
      return completePlacementCreate(action, available, resulting);
    case "placement-remove":
    case "placement-move": {
      return validateMutableOccurrence(action, available, resulting);
    }
  }
}

function completePlacementCreate(
  action: Extract<AuthoredAction, { kind: "placement-create" }>,
  available: ScopedProjection,
  resulting: ScopedProjection,
): Extract<AuthoredAction, { kind: "placement-create" }> {
  if (!isPresentNodeOutsideTrash(resulting.identity.workspaceNodeId, resulting, action.nodeId)) {
    throw new Error("Occurrence Node is absent from the observed projection");
  }
  assertPlacementParent(resulting, action.parentNodeId);
  const existing = available.occurrences[action.placementId];
  if (existing && (existing.nodeId !== action.nodeId || existing.parentNodeId !== action.parentNodeId)) {
    throw new Error("Occurrence identity already names another placement");
  }
  assertUniquePlacement(resulting, action.nodeId, action.parentNodeId, action.placementId);
  return action;
}

function validateMutableOccurrence(
  action: MutablePlacementAction,
  available: ScopedProjection,
  resulting: ScopedProjection,
): MutablePlacementAction {
  if (action.placementId === workspaceTrashOccurrenceId(available.identity.workspaceNodeId)) {
    throw new Error("Workspace Trash role cannot be moved or deleted");
  }
  const occurrence = available.occurrences[action.placementId];
  if (!occurrence) {
    throw new Error("Occurrence target is absent from the observed projection");
  }
  if (action.kind === "placement-move") {
    assertPlacementParent(resulting, action.parentNodeId);
    assertUniquePlacement(resulting, occurrence.nodeId, action.parentNodeId, action.placementId);
  }
  return action;
}

function assertPlacementParent(projection: ScopedProjection, parentNodeId: string): void {
  if (!isPresentNodeOutsideTrash(projection.identity.workspaceNodeId, projection, parentNodeId)) {
    throw new Error("Parent Node is absent from the observed projection");
  }
}

function assertUniquePlacement(
  projection: ScopedProjection,
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
    throw new Error("A Node cannot appear twice in one parent Node childOccurrences list");
  }
}
