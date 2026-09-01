import { factObserves, materializedFieldOccurrenceId, type FactAction } from "../fact/index.js";
import { statesByAction } from "./causal-collection.js";
import { activeFieldConfigurationActions } from "./field-configuration-actions.js";
import { fieldConfigurationPlacement, fieldConfigurationPlacementIds } from "./field-configuration-graph.js";
import { optionalFieldPlacement, optionalFieldPlacementIds, optionalFieldStates } from "./optional-field-graph.js";
import { templateMemberOccurrenceId } from "./projection-identity.js";
import {
  searchExpressionPlacement,
  searchExpressionPlacementIds,
  searchExpressionStates,
} from "./search-expression-graph.js";
import {
  supertagApplicationPlacement,
  supertagApplicationPlacementIds,
  supertagApplicationStates,
} from "./supertag-application-graph.js";
import { templateFieldPlacement, templateFieldPlacementIds, templateFieldStates } from "./template-field-graph.js";
import { viewPlacement, viewPlacementIds, viewStates } from "./view-definition-graph.js";

export type PlacementProjectionContext = ReturnType<typeof createPlacementProjectionContext>;

type PlacementCreation = Readonly<{
  nodeId: string;
  parentNodeId: string;
  anchor: Extract<FactAction["action"], { kind: "placement-create" }>["anchor"];
  derived: boolean;
}>;

export function createPlacementProjectionContext(active: readonly FactAction[]) {
  return {
    active,
    activeFieldConfigurations: new Set(activeFieldConfigurationActions(active).map(({ id }) => id)),
    applicationStates: statesByAction(supertagApplicationStates(active)),
    templateFieldStates: statesByAction(templateFieldStates(active)),
    optionalFieldStates: statesByAction(optionalFieldStates(active)),
    searchExpressionStates: statesByAction(searchExpressionStates(active)),
    views: statesByAction(viewStates(active)),
  };
}

export function placementIdsForAction(action: FactAction, context: PlacementProjectionContext): readonly string[] {
  const authoredAction = action.action;
  if (authoredAction.kind === "node-create") {
    return authoredAction.originalPlacement ? [authoredAction.originalPlacement.placementId] : [];
  }
  if (
    authoredAction.kind === "placement-create" ||
    authoredAction.kind === "placement-remove" ||
    authoredAction.kind === "placement-move"
  ) {
    return [authoredAction.placementId];
  }
  if (authoredAction.kind === "field-value-remove") {
    return [authoredAction.valuePlacementId];
  }
  if (authoredAction.kind === "materialized-field-clear") {
    return context.active.flatMap((candidate) => {
      const creation = candidate.action;
      return creation.kind === "field-materialize" &&
        creation.ownerNodeId === authoredAction.ownerNodeId &&
        creation.fieldDefinitionId === authoredAction.fieldDefinitionId &&
        factObserves(action, candidate)
        ? [materializedFieldOccurrenceId(creation.ownerNodeId, creation.fieldDefinitionId)]
        : [];
    });
  }
  if (authoredAction.kind === "template-member-add") {
    return [templateMemberOccurrenceId(action.id)];
  }
  if (authoredAction.kind === "template-member-remove") {
    return context.active.flatMap((candidate) => {
      const addition = candidate.action;
      return addition.kind === "template-member-add" &&
        addition.supertagId === authoredAction.supertagId &&
        addition.templateNodeId === authoredAction.templateNodeId &&
        factObserves(action, candidate)
        ? [templateMemberOccurrenceId(candidate.id)]
        : [];
    });
  }
  return [
    ...fieldConfigurationPlacementIds(action, context.activeFieldConfigurations),
    ...supertagApplicationPlacementIds(action, context.applicationStates),
    ...templateFieldPlacementIds(action, context.templateFieldStates),
    ...optionalFieldPlacementIds(action, context.optionalFieldStates),
    ...searchExpressionPlacementIds(action, context.searchExpressionStates),
    ...viewPlacementIds(action, context.views),
  ];
}

export function placementCreationForAction(
  workspaceNodeId: string,
  action: FactAction,
  placementId: string,
  context: PlacementProjectionContext,
): PlacementCreation | null {
  const authoredAction = action.action;
  if (authoredAction.kind === "node-create" && authoredAction.originalPlacement !== null) {
    return {
      nodeId: authoredAction.nodeId,
      parentNodeId: authoredAction.ownerNodeId,
      anchor: authoredAction.originalPlacement.anchor,
      derived: false,
    };
  }
  if (authoredAction.kind === "placement-create") {
    return {
      nodeId: authoredAction.nodeId,
      parentNodeId: authoredAction.parentNodeId,
      anchor: authoredAction.anchor,
      derived: false,
    };
  }
  if (authoredAction.kind === "template-member-add") {
    return {
      nodeId: authoredAction.templateNodeId,
      parentNodeId: authoredAction.supertagId,
      anchor: authoredAction.anchor,
      derived: true,
    };
  }
  if (authoredAction.kind === "field-configuration-set") {
    return fieldConfigurationPlacement(action, placementId);
  }
  const applicationState = context.applicationStates.get(action.id);
  if (applicationState !== undefined) {
    return supertagApplicationPlacement(applicationState, placementId);
  }
  const templateFieldState = context.templateFieldStates.get(action.id);
  if (templateFieldState !== undefined) {
    return templateFieldPlacement(workspaceNodeId, templateFieldState, placementId);
  }
  const optionalFieldState = context.optionalFieldStates.get(action.id);
  if (optionalFieldState !== undefined) {
    return optionalFieldPlacement(optionalFieldState, placementId);
  }
  const searchExpressionState = context.searchExpressionStates.get(action.id);
  if (searchExpressionState !== undefined) {
    return searchExpressionPlacement(searchExpressionState, placementId);
  }
  const view = context.views.get(action.id);
  return view === undefined ? null : viewPlacement(view, placementId);
}

export function isPlacementRemovalAction(action: FactAction): boolean {
  return (
    action.action.kind === "placement-remove" ||
    action.action.kind === "field-value-remove" ||
    action.action.kind === "materialized-field-clear" ||
    action.action.kind === "template-member-remove"
  );
}
