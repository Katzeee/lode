import type { FactActionId, GraphAction } from "../../../src/domain/fact/index.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";
import { end, Facts } from "./reconcile-test-helpers.js";

export const searchProposalLifecycleCases = {
  "search-expression-add": searchExpressionAddCase,
  "search-expression-configure": searchExpressionConfigureCase,
  "search-expression-move": searchExpressionMoveCase,
  "search-expression-remove": searchExpressionRemoveCase,
  "search-expression-restore": searchExpressionRestoreCase,
} as const;

function searchExpressionAddCase(): ProposalLifecycleCase {
  return lifecycle(searchFacts(), addExpression(null, "proposal"));
}

function searchExpressionConfigureCase(): ProposalLifecycleCase {
  const facts = withExpression();
  return lifecycle(facts, {
    kind: "search-expression-configure",
    expressionId: expressionId(facts),
    clause: { kind: "text", text: "configured" },
  });
}

function searchExpressionMoveCase(): ProposalLifecycleCase {
  const facts = searchFacts();
  const root = facts.add({
    kind: "search-expression-add",
    expressionHostId: "search",
    parentExpressionId: null,
    clause: { kind: "and" },
    anchor: end,
  });
  const first = facts.add(addExpression(root.id, "first"));
  const second = facts.add(addExpression(root.id, "second"));
  return lifecycle(facts, {
    kind: "search-expression-move",
    expressionId: second.id,
    parentExpressionId: root.id,
    anchor: { after: null, before: first.id, affinity: "before", fallback: "start" },
  });
}

function searchExpressionRemoveCase(): ProposalLifecycleCase {
  const facts = withExpression();
  return lifecycle(facts, { kind: "search-expression-remove", expressionId: expressionId(facts) });
}

function searchExpressionRestoreCase(): ProposalLifecycleCase {
  const facts = withExpression();
  const expression = expressionId(facts);
  facts.add({ kind: "search-expression-remove", expressionId: expression });
  return lifecycle(facts, { kind: "search-expression-restore", expressionId: expression });
}

function withExpression(): Facts {
  const facts = searchFacts();
  facts.add(addExpression(null, "initial"));
  return facts;
}

function searchFacts(): Facts {
  const facts = new Facts();
  addPlacedNode(facts, "search", "direct", "workspace", "search-original", "search");
  return facts;
}

function addExpression(parentExpressionId: FactActionId | null, text: string): GraphAction {
  return {
    kind: "search-expression-add",
    expressionHostId: "search",
    parentExpressionId,
    clause: { kind: "text", text },
    anchor: end,
  };
}

function expressionId(facts: Facts) {
  const action = facts.values
    .flatMap((fact) =>
      fact.body.kind === "action" ? fact.body.actions.map((candidate, index) => ({ fact, candidate, index })) : [],
    )
    .find(({ candidate }) => candidate.kind === "search-expression-add");
  if (!action) {
    throw new Error("Search fixture has no expression action");
  }
  return `${action.fact.id}/actions/${action.index}` as const;
}

function lifecycle(facts: Facts, action: GraphAction): ProposalLifecycleCase {
  return { kind: action.kind, facts, proposal: facts.add(action, "proposal") };
}
