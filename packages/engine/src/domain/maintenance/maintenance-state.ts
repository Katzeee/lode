import {
  factObserves,
  actionRelations,
  type FactAction,
  type FactActionId,
  type Fact,
  type AuthoredAction,
} from "../fact/index.js";

export function purgedNodeIds(facts: readonly Fact[]): ReadonlySet<string> {
  return new Set(
    facts.flatMap((fact) =>
      fact.body.kind === "maintenance" && fact.body.action.kind === "node-purge" ? [fact.body.action.nodeId] : [],
    ),
  );
}

export function excludePurgedActions(
  actions: readonly FactAction[],
  purged: ReadonlySet<string>,
): readonly FactAction[] {
  return purged.size === 0
    ? actions
    : actions.filter((action) => ![...purged].some((nodeId) => actionReferencesNode(action.action, nodeId)));
}

export function actionReferencesNode(action: AuthoredAction, nodeId: string): boolean {
  return actionRelations(action).nodeIds.includes(nodeId);
}

export function nodeDeletionActionIds(active: readonly FactAction[]): ReadonlyMap<string, readonly FactActionId[]> {
  const result = new Map<string, FactActionId[]>();
  for (const fact of active) {
    const action = fact.action;
    if (
      action.kind === "node-trash" &&
      !active.some(
        (restore) =>
          restore.action.kind === "node-restore" &&
          restore.action.nodeId === action.nodeId &&
          actionObserves(restore, fact),
      )
    ) {
      const ids = result.get(action.nodeId) ?? [];
      ids.push(fact.id);
      result.set(action.nodeId, ids);
    }
  }
  return result;
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}
