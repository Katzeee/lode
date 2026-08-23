import type { FactAction, EditFact, Fact } from "./types.js";

function isEditFact(fact: Fact): fact is EditFact {
  return fact.body.kind === "edit";
}

export function factActions(fact: Fact): readonly FactAction[] {
  if (!isEditFact(fact)) {
    return [];
  }
  return fact.body.actions.map((action, index) => ({
    id: factActionId(fact.id, index),
    factId: fact.id,
    index,
    coordinate: fact.coordinate,
    actorId: fact.body.actorId,
    intent: fact.body.intent,
    action,
  }));
}

export function factActionsFromFacts(facts: readonly Fact[]): readonly FactAction[] {
  return facts.flatMap(factActions);
}

export function owningFactIds(facts: readonly Fact[], actionIds: readonly FactAction["id"][]): readonly Fact["id"][] {
  const requested = new Set(actionIds);
  return [
    ...new Set(
      factActionsFromFacts(facts)
        .filter((action) => requested.has(action.id))
        .map((action) => action.factId),
    ),
  ];
}

export function factActionId(factId: Fact["id"], actionIndex: number): FactAction["id"] {
  return `${factId}/actions/${actionIndex}`;
}
