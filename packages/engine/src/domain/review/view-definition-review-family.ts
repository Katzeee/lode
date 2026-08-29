import { canonicalJson, compareCausalOrder, isViewAction, type FactAction, type FactActionId } from "../fact/index.js";
import type { InterpretedProjection, InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { ViewDefinitionDecisionEffect, ViewDefinitionDecisionState } from "./types.js";

const VIEW_ACTION_KINDS = [
  "shared-default-view-add",
  "shared-default-view-remove",
  "shared-default-view-restore",
  "view-mode-set",
  "view-column-add",
  "view-column-remove",
  "view-column-move",
  "view-sort-add",
  "view-sort-configure",
  "view-sort-remove",
  "view-sort-restore",
  "view-group-add",
  "view-group-remove",
  "view-filter-add",
  "view-filter-remove",
  "view-filter-restore",
] as const;

export const viewDefinitionReviewFamily = {
  key: "view-definition",
  actionKinds: VIEW_ACTION_KINDS,
  scopes(fact) {
    const identity = actionTarget(fact);
    return [reviewScope("view-definition", identity), associatedNodeScope(identity)];
  },
  candidates: ({ generation, pending }) => candidates(generation, pending),
  effect(fact, _targets, generation) {
    const viewId = viewIdFor(fact, generation);
    if (!viewId) {
      return null;
    }
    const effect = viewDefinitionEffect(viewId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `view-definition/${viewId}`, effect };
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      if (!isViewAction(fact.action)) {
        continue;
      }
      const viewId = viewIdFor(fact, generation);
      if (!viewId) {
        continue;
      }
      impacts.add(viewId);
      const effect = viewDefinitionEffect(viewId, generation);
      for (const state of [effect.origin, effect.review]) {
        if (state) {
          impacts.add(state.hostNodeId);
          impacts.add(state.attachmentNodeId);
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function candidates(
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactActionId, FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<FactActionId, FactAction[]>();
  for (const fact of pending.values()) {
    if (!isViewAction(fact.action)) {
      continue;
    }
    const viewId = viewIdFor(fact, generation);
    if (!viewId) {
      continue;
    }
    const group = groups.get(viewId) ?? [];
    group.push(fact);
    groups.set(viewId, group);
  }
  return [...groups].flatMap(([viewId, facts]) => {
    const effect = viewDefinitionEffect(viewId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "view-definition" as const, identity: viewId },
            targets: [...facts].sort(compareCausalOrder).map(({ id }) => id),
            bridges: [],
          },
        ];
  });
}

function viewDefinitionEffect(
  viewId: FactActionId,
  generation: InterpretedProjectionGeneration,
): ViewDefinitionDecisionEffect {
  return {
    kind: "view-definition",
    viewId,
    origin: stateFor(viewId, generation.origin),
    review: stateFor(viewId, generation.review),
  };
}

function stateFor(viewId: FactActionId, projection: InterpretedProjection): ViewDefinitionDecisionState | null {
  const definition = findView(projection, viewId);
  return definition
    ? {
        hostNodeId: definition.hostNodeId,
        attachmentNodeId: definition.attachmentNodeId,
        attachmentOccurrenceId: definition.attachmentOccurrenceId,
        viewType: definition.viewType,
        options: definition.options,
        optionsConflicted: definition.optionsConflicted,
      }
    : null;
}

function viewIdFor(fact: FactAction, generation: InterpretedProjectionGeneration): FactActionId | null {
  if (!isViewAction(fact.action)) {
    return null;
  }
  if (fact.action.kind === "shared-default-view-add") {
    return fact.id;
  }
  if (fact.action.kind === "shared-default-view-remove") {
    for (const projection of [generation.origin, generation.review]) {
      const viewId = projection.sharedDefaultViewDefinitions[fact.action.hostNodeId]?.[0]?.viewId;
      if (viewId) {
        return viewId;
      }
    }
    return null;
  }
  if ("viewId" in fact.action) {
    return fact.action.viewId;
  }
  for (const projection of [generation.origin, generation.review]) {
    for (const view of Object.values(projection.sharedDefaultViewDefinitions).flat()) {
      const action = fact.action;
      if (
        action.kind === "view-column-move" &&
        view.options.columns.some((column) => column.columnId === action.columnId)
      ) {
        return view.viewId;
      }
      if (
        (action.kind === "view-sort-configure" || action.kind === "view-sort-restore") &&
        view.options.sort?.sortId === action.sortId
      ) {
        return view.viewId;
      }
      if (action.kind === "view-filter-restore" && view.options.filter?.filterId === action.filterId) {
        return view.viewId;
      }
    }
  }
  return null;
}

function actionTarget(fact: FactAction): string {
  if (!isViewAction(fact.action)) {
    throw new Error("View Review family received another AuthoredAction family");
  }
  if (fact.action.kind === "shared-default-view-add") {
    return fact.id;
  }
  if (fact.action.kind === "shared-default-view-remove") {
    return fact.action.hostNodeId;
  }
  if ("viewId" in fact.action) {
    return fact.action.viewId;
  }
  if (fact.action.kind === "view-column-move") {
    return fact.action.columnId;
  }
  if (fact.action.kind === "view-sort-configure" || fact.action.kind === "view-sort-restore") {
    return fact.action.sortId;
  }
  return fact.action.filterId;
}

function findView(projection: InterpretedProjection, viewId: FactActionId) {
  return Object.values(projection.sharedDefaultViewDefinitions)
    .flat()
    .find((view) => view.viewId === viewId);
}
