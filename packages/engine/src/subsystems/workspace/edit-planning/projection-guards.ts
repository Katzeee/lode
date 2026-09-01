import type { NodeSeed } from "../../../domain/fact/index.js";
import { nodeLocation, type InterpretedProjection, type MaterializedField } from "../../../domain/reconcile/index.js";
import { EditPlanningRejection } from "./planning-rejection.js";

export function requireActiveNode(nodeId: string, available: InterpretedProjection, label: string): void {
  if (nodeLocation(available.identity.workspaceNodeId, available, nodeId) !== "active") {
    throw new EditPlanningRejection(`${label} is not an active Node`);
  }
}

export function requireUnusedNode(nodeId: string, available: InterpretedProjection, label: string): void {
  if (available.nodes[nodeId] !== undefined) {
    throw new EditPlanningRejection(`${label} identity already exists`);
  }
}

export function requireUnusedOccurrence(occurrenceId: string, available: InterpretedProjection, label: string): void {
  if (available.occurrences[occurrenceId] !== undefined) {
    throw new EditPlanningRejection(`${label} Occurrence identity already exists`);
  }
}

export function materializedFieldFor(
  available: InterpretedProjection,
  ownerNodeId: string,
  fieldDefinitionId: string,
): MaterializedField | undefined {
  return available.materializedFields[ownerNodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId);
}

export function textSeed(value: string): NodeSeed {
  return { text: [{ value, attributes: {} }] };
}
