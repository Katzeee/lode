import {
  contributionOwnerNodeIds,
  factActionContributions,
  factObserves,
  type FactAction,
  type FactActionId,
} from "../fact/index.js";
import type { ProjectionPlanCache } from "./projection-types.js";

export function finalizedNodeIds(actions: readonly FactAction[]): ReadonlySet<string> {
  return new Set(
    actions.flatMap((fact) =>
      factActionContributions(fact).flatMap((contribution) =>
        contribution.kind === "terminal-cutoff" ? [contribution.nodeId] : [],
      ),
    ),
  );
}

export function effectiveContributions(
  actions: readonly FactAction[],
  finalized: ReadonlySet<string>,
): readonly FactAction[] {
  return actions.filter(
    (fact) =>
      !isTerminalContribution(fact) && contributionOwnerNodeIds(fact.action).every((nodeId) => !finalized.has(nodeId)),
  );
}

export function effectivePlanCache(
  cache: ProjectionPlanCache,
  active: readonly FactAction[],
  effective: readonly FactAction[],
): ProjectionPlanCache {
  const retained = new Set([
    ...effective.map((action) => action.id),
    ...active.filter(isTerminalContribution).map((action) => action.id),
  ]);
  return {
    activeActionIds: cache.activeActionIds.filter((id) => retained.has(id)),
    supportByAction: cache.supportByAction,
  };
}

function isTerminalContribution(fact: FactAction): boolean {
  return factActionContributions(fact).some((contribution) => contribution.kind === "terminal-cutoff");
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
