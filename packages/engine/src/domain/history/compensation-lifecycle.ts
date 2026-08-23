import { factObserves, type FactAction } from "../fact/index.js";

export function hasAlternateNodeCreator(
  target: FactAction,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
): boolean {
  const authoredAction = target.action;
  if (authoredAction.kind !== "node-create" && authoredAction.kind !== "node-restore") {
    return false;
  }
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
  target: FactAction,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
): boolean {
  const authoredAction = target.action;
  if (authoredAction.kind !== "placement-create") {
    return false;
  }
  return activeFacts.some((fact) => {
    if (targetIds.has(fact.id)) {
      return false;
    }
    const candidate = fact.action;
    const alternateCreator =
      candidate.kind === "placement-create" && candidate.placementId === authoredAction.placementId;
    if (alternateCreator) {
      return !actionObserves(target, fact);
    }
    if (actionObserves(target, fact)) {
      return false;
    }
    return (
      ("placementId" in candidate && candidate.placementId === authoredAction.placementId) ||
      ((candidate.kind === "original-promote" || candidate.kind === "node-restore") &&
        candidate.nodeId === authoredAction.nodeId)
    );
  });
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}
