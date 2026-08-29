import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  type FactActionId,
  type GraphAction,
} from "../../../src/domain/fact/index.js";
import { supertagAndFieldFacts } from "./materialized-field-test-facts.js";
import { addDefinitionNode } from "./placed-node-test-helpers.js";
import type { ProposalLifecycleCase } from "./proposal-lifecycle-types.js";
import { end, type Facts } from "./reconcile-test-helpers.js";

export const viewProposalLifecycleCases = {
  "shared-default-view-add": sharedDefaultViewAddCase,
  "shared-default-view-remove": sharedDefaultViewRemoveCase,
  "shared-default-view-restore": sharedDefaultViewRestoreCase,
  "view-mode-set": viewModeSetCase,
  "view-column-add": viewColumnAddCase,
  "view-column-move": viewColumnMoveCase,
  "view-column-remove": viewColumnRemoveCase,
  "view-sort-add": viewSortAddCase,
  "view-sort-configure": viewSortConfigureCase,
  "view-sort-remove": viewSortRemoveCase,
  "view-sort-restore": viewSortRestoreCase,
  "view-group-add": viewGroupAddCase,
  "view-group-remove": viewGroupRemoveCase,
  "view-filter-add": viewFilterAddCase,
  "view-filter-remove": viewFilterRemoveCase,
  "view-filter-restore": viewFilterRestoreCase,
} as const;

function sharedDefaultViewAddCase(): ProposalLifecycleCase {
  return lifecycle(supertagAndFieldFacts(), addView());
}

function sharedDefaultViewRemoveCase(): ProposalLifecycleCase {
  const facts = withView();
  return lifecycle(facts, { kind: "shared-default-view-remove", hostNodeId: "node" });
}

function sharedDefaultViewRestoreCase(): ProposalLifecycleCase {
  const facts = withView();
  const viewId = actionId(facts, "shared-default-view-add");
  facts.add({ kind: "shared-default-view-remove", hostNodeId: "node" });
  return lifecycle(facts, { kind: "shared-default-view-restore", viewId });
}

function viewModeSetCase(): ProposalLifecycleCase {
  const facts = withView();
  return lifecycle(facts, { kind: "view-mode-set", viewId: viewId(facts), viewType: "table" });
}

function viewColumnAddCase(): ProposalLifecycleCase {
  const facts = withView();
  return lifecycle(facts, addColumn(viewId(facts)));
}

function viewColumnMoveCase(): ProposalLifecycleCase {
  const facts = withColumn();
  const second = facts.add({
    kind: "view-column-add",
    viewId: viewId(facts),
    fieldDefinitionId: "field-two",
    anchor: end,
  });
  return lifecycle(facts, {
    kind: "view-column-move",
    columnId: second.id,
    anchor: {
      after: null,
      before: actionId(facts, "view-column-add"),
      affinity: "before",
      fallback: "start",
    },
  });
}

function viewColumnRemoveCase(): ProposalLifecycleCase {
  const facts = withColumn();
  return lifecycle(facts, { kind: "view-column-remove", viewId: viewId(facts), fieldDefinitionId: "field" });
}

function viewSortAddCase(): ProposalLifecycleCase {
  const facts = withView();
  return lifecycle(facts, addSort(viewId(facts)));
}

function viewSortConfigureCase(): ProposalLifecycleCase {
  const facts = withSort();
  return lifecycle(facts, {
    kind: "view-sort-configure",
    sortId: actionId(facts, "view-sort-add"),
    fieldDefinitionId: "field",
    direction: "descending",
  });
}

function viewSortRemoveCase(): ProposalLifecycleCase {
  const facts = withSort();
  return lifecycle(facts, { kind: "view-sort-remove", viewId: viewId(facts) });
}

function viewSortRestoreCase(): ProposalLifecycleCase {
  const facts = withSort();
  const sortId = actionId(facts, "view-sort-add");
  facts.add({ kind: "view-sort-remove", viewId: viewId(facts) });
  return lifecycle(facts, { kind: "view-sort-restore", sortId });
}

function viewGroupAddCase(): ProposalLifecycleCase {
  const facts = withView();
  return lifecycle(facts, { kind: "view-group-add", viewId: viewId(facts), fieldDefinitionId: "field" });
}

function viewGroupRemoveCase(): ProposalLifecycleCase {
  const facts = withView();
  facts.add({ kind: "view-group-add", viewId: viewId(facts), fieldDefinitionId: "field" });
  return lifecycle(facts, { kind: "view-group-remove", viewId: viewId(facts) });
}

function viewFilterAddCase(): ProposalLifecycleCase {
  const facts = withView();
  const filter = facts.add({ kind: "view-filter-add", viewId: viewId(facts) }, "proposal");
  facts.add(
    {
      kind: "search-expression-add",
      expressionHostId: filter.id,
      parentExpressionId: null,
      clause: { kind: "text", text: "candidate" },
      anchor: end,
    },
    "proposal",
  );
  return { kind: "view-filter-add", facts, proposal: filter };
}

function viewFilterRemoveCase(): ProposalLifecycleCase {
  const facts = withFilter();
  return lifecycle(facts, { kind: "view-filter-remove", viewId: viewId(facts) });
}

function viewFilterRestoreCase(): ProposalLifecycleCase {
  const facts = withFilter();
  const filterId = actionId(facts, "view-filter-add");
  facts.add({ kind: "view-filter-remove", viewId: viewId(facts) });
  return lifecycle(facts, { kind: "view-filter-restore", filterId });
}

function withView(): Facts {
  const facts = supertagAndFieldFacts();
  addDefinitionNode(facts, "field-two", FIELD_DEFINITION_INTRINSIC_NODE_TYPE);
  facts.add(addView());
  return facts;
}

function withColumn(): Facts {
  const facts = withView();
  facts.add(addColumn(viewId(facts)));
  return facts;
}

function withSort(): Facts {
  const facts = withView();
  facts.add(addSort(viewId(facts)));
  return facts;
}

function withFilter(): Facts {
  const facts = withView();
  const filter = facts.add({ kind: "view-filter-add", viewId: viewId(facts) });
  facts.add({
    kind: "search-expression-add",
    expressionHostId: filter.id,
    parentExpressionId: null,
    clause: { kind: "text", text: "candidate" },
    anchor: end,
  });
  return facts;
}

function addView(): GraphAction {
  return { kind: "shared-default-view-add", hostNodeId: "node", viewType: "outline", anchor: end };
}

function addColumn(viewIdValue: FactActionId): GraphAction {
  return { kind: "view-column-add", viewId: viewIdValue, fieldDefinitionId: "field", anchor: end };
}

function addSort(viewIdValue: FactActionId): GraphAction {
  return {
    kind: "view-sort-add",
    viewId: viewIdValue,
    fieldDefinitionId: "field",
    direction: "ascending",
  };
}

function viewId(facts: Facts): FactActionId {
  return actionId(facts, "shared-default-view-add");
}

function actionId(facts: Facts, kind: GraphAction["kind"]): FactActionId {
  const action = facts.values
    .flatMap((fact) =>
      fact.body.kind === "action" ? fact.body.actions.map((candidate, index) => ({ fact, candidate, index })) : [],
    )
    .find(({ candidate }) => candidate.kind === kind);
  if (!action) {
    throw new Error(`View fixture has no ${kind} action`);
  }
  return `${action.fact.id}/actions/${action.index}`;
}

function lifecycle(facts: Facts, action: GraphAction): ProposalLifecycleCase {
  return { kind: action.kind, facts, proposal: facts.add(action, "proposal") };
}
