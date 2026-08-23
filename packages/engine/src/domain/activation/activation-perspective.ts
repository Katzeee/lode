import {
  factActionsFromFacts,
  type FactAction,
  type FactActionId,
  type Fact,
  type ResolutionFact,
  type ProjectionPerspective,
} from "../fact/index.js";

export function resolutionsByAction(
  facts: readonly Fact[],
  actions: readonly FactAction[] = factActionsFromFacts(facts),
): ReadonlyMap<FactActionId, readonly ResolutionFact[]> {
  const resolutions = new Map<FactActionId, ResolutionFact[]>();
  const actionIdsByFactId = new Map<string, FactActionId[]>();
  for (const action of actions) {
    const ids = actionIdsByFactId.get(action.factId) ?? [];
    ids.push(action.id);
    actionIdsByFactId.set(action.factId, ids);
  }
  const superseded = new Set(facts.flatMap((fact) => (isResolution(fact) ? fact.body.adjudicatesResolutionIds : [])));
  for (const fact of facts) {
    if (!isResolution(fact) || superseded.has(fact.id)) {
      continue;
    }
    for (const proposalFactId of fact.body.proposalFactIds) {
      for (const factActionId of actionIdsByFactId.get(proposalFactId) ?? []) {
        const current = resolutions.get(factActionId) ?? [];
        current.push(fact);
        resolutions.set(factActionId, current);
      }
    }
  }
  return resolutions;
}

export function eligibleForPerspective(
  action: FactAction,
  resolutions: readonly ResolutionFact[] | undefined,
  mode: ProjectionPerspective,
): boolean {
  if (action.intent === "direct") {
    return true;
  }
  const decisions = new Set(resolutions?.map((resolution) => resolution.body.decision) ?? []);
  if (decisions.size > 1) {
    return mode === "review";
  }
  if (decisions.has("reject")) {
    return false;
  }
  if (decisions.has("accept")) {
    return true;
  }
  return mode === "review";
}

function isResolution(fact: Fact): fact is ResolutionFact {
  return fact.body.kind === "resolution";
}
