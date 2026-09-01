import { factObserves, type FactAction } from "../fact/index.js";
import type { CompensationTargetAction } from "./compensation-types.js";

export function hasAlternateNodeCreator(
  target: FactAction<Extract<CompensationTargetAction, { kind: "node-create" | "node-restore" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
): boolean {
  const authoredAction = target.action;
  return activeFacts.some((fact) => {
    if (targetIds.has(fact.id)) {
      return false;
    }
    const candidate = fact.action;
    return authoredAction.kind === "node-create"
      ? candidate.kind === "node-create" && candidate.nodeId === authoredAction.nodeId
      : candidate.kind === "node-restore" && candidate.nodeId === authoredAction.nodeId;
  });
}

export function hasIndependentOccurrenceWork(
  target: FactAction<Extract<CompensationTargetAction, { kind: "placement-create" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
): boolean {
  const authoredAction = target.action;
  return activeFacts.some((fact) => {
    if (targetIds.has(fact.id)) {
      return false;
    }
    const candidate = fact.action;
    const alternateCreator =
      candidate.kind === "placement-create" && candidate.placementId === authoredAction.placementId;
    if (alternateCreator) {
      return !factObserves(target, fact);
    }
    if (factObserves(target, fact)) {
      return false;
    }
    return (
      ("placementId" in candidate && candidate.placementId === authoredAction.placementId) ||
      ((candidate.kind === "original-promote" || candidate.kind === "node-restore") &&
        candidate.nodeId === authoredAction.nodeId)
    );
  });
}
