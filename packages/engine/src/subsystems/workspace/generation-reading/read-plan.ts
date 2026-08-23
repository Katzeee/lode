import { expandEditAction, type EditAction } from "../../../domain/edit/index.js";
import { actionRelations, type AuthoredAction, type FactAction } from "../../../domain/fact/index.js";
import {
  searchExpressionProjectionIdentity,
  viewColumnNodeId,
  viewFilterNodeId,
  viewGroupNodeId,
  viewProjectionIdentity,
  viewSortNodeId,
} from "../../../domain/reconcile/index.js";
import { addTypedFieldValueEditReadScope, isTypedFieldValueEdit } from "./typed-field-value-read-scope.js";
import {
  addMetanodeReadScope,
  emptyGenerationReadScope,
  requiresOwnerGraph,
  type GenerationReadScope,
} from "./read-scope.js";
import { addSearchViewEditReadScope } from "./search-view-read-scope.js";
import { addTemplateFieldEditReadScope } from "./template-field-read-scope.js";

export type GenerationReadPlan = Readonly<{
  actions: readonly AuthoredAction[];
  readsOwnerGraph: boolean;
  createScope: () => GenerationReadScope;
}>;

export function planFactActionGenerationRead(facts: readonly FactAction[]): GenerationReadPlan {
  const actions = facts.map((fact) => fact.action);
  return {
    actions,
    readsOwnerGraph: actions.some(requiresOwnerGraph),
    createScope: () => factActionReadScope(facts),
  };
}

export function planEditGenerationRead(edits: readonly EditAction[]): GenerationReadPlan {
  const actions = editGenerationReadActions(edits);
  return {
    actions,
    readsOwnerGraph:
      actions.some(requiresOwnerGraph) ||
      edits.some(
        (edit) =>
          edit.kind === "reference-promote" ||
          edit.kind === "node-delete" ||
          edit.kind === "node-restore" ||
          edit.kind === "occurrence-delete" ||
          edit.kind === "shared-default-view-create" ||
          edit.kind === "shared-default-view-remove" ||
          edit.kind === "field-value-create" ||
          isTypedFieldValueEdit(edit) ||
          edit.kind === "url-node-create" ||
          edit.kind === "code-node-configure" ||
          edit.kind === "view-sort-by-node-name" ||
          edit.kind === "supertag-template-field-static-default-set",
      ),
    createScope: () => editReadScope(edits, actions),
  };
}

function editGenerationReadActions(edits: readonly EditAction[]): AuthoredAction[] {
  return edits.flatMap((edit) =>
    edit.kind === "node-delete"
      ? [{ kind: "node-trash" as const, nodeId: edit.nodeId }]
      : edit.kind === "reference-promote" ||
          edit.kind === "node-restore" ||
          edit.kind === "occurrence-create" ||
          edit.kind === "occurrence-delete" ||
          edit.kind === "occurrence-restore" ||
          edit.kind === "occurrence-move" ||
          edit.kind === "supertag-application-create" ||
          edit.kind === "supertag-remove" ||
          edit.kind === "supertag-template-field-create" ||
          edit.kind === "supertag-template-field-add-existing" ||
          edit.kind === "supertag-template-field-make-discoverable" ||
          edit.kind === "supertag-template-field-remove" ||
          edit.kind === "supertag-template-field-static-default-set" ||
          edit.kind === "supertag-template-field-visibility-set" ||
          edit.kind === "supertag-optional-field-contribution-add" ||
          edit.kind === "supertag-optional-field-contribution-remove" ||
          edit.kind === "inline-reference-alias-create" ||
          edit.kind === "search-expression-create" ||
          edit.kind === "search-expression-add" ||
          edit.kind === "search-expression-configure" ||
          edit.kind === "search-expression-move" ||
          edit.kind === "search-expression-remove" ||
          edit.kind === "shared-default-view-create" ||
          edit.kind === "shared-default-view-remove" ||
          edit.kind === "view-mode-set" ||
          edit.kind === "view-column-add" ||
          edit.kind === "view-column-remove" ||
          edit.kind === "view-column-move" ||
          edit.kind === "view-sort-add" ||
          edit.kind === "view-sort-configure" ||
          edit.kind === "view-sort-remove" ||
          edit.kind === "view-sort-by-node-name" ||
          edit.kind === "view-group-add" ||
          edit.kind === "view-group-remove" ||
          edit.kind === "view-filter-create" ||
          edit.kind === "view-filter-remove" ||
          edit.kind === "view-filter-expression-add" ||
          edit.kind === "view-filter-expression-configure" ||
          edit.kind === "view-filter-expression-move" ||
          edit.kind === "view-filter-expression-remove" ||
          edit.kind === "field-datatype-configure" ||
          edit.kind === "field-cardinality-configure" ||
          edit.kind === "field-optionality-configure" ||
          edit.kind === "field-initialization-expression-configure" ||
          edit.kind === "field-value-create" ||
          isTypedFieldValueEdit(edit) ||
          edit.kind === "url-node-create" ||
          edit.kind === "code-node-configure"
        ? []
        : expandEditAction(edit),
  );
}

function editReadScope(edits: readonly EditAction[], actions: readonly AuthoredAction[]): GenerationReadScope {
  const scope = actionReadScope(actions);
  for (const edit of edits) {
    if (
      addBreadthEditReadScope(scope, edit) ||
      addTemplateFieldEditReadScope(scope, edit) ||
      addSearchViewEditReadScope(scope, edit)
    ) {
      continue;
    }
    if (edit.kind === "reference-promote") {
      scope.occurrences.add(edit.occurrenceId);
    } else if (
      edit.kind === "occurrence-create" ||
      edit.kind === "occurrence-restore" ||
      edit.kind === "occurrence-move"
    ) {
      scope.occurrences.add(edit.occurrenceId);
      scope.nodes.add(edit.parentNodeId);
      scope.childOccurrences.add(edit.parentNodeId);
      if (edit.kind !== "occurrence-move") {
        scope.nodes.add(edit.nodeId);
      }
    } else if (edit.kind === "occurrence-delete") {
      scope.occurrences.add(edit.occurrenceId);
    } else if (edit.kind === "node-delete") {
      scope.nodes.add(edit.nodeId);
    } else if (edit.kind === "node-restore") {
      scope.nodes.add(edit.nodeId);
      scope.nodes.add(edit.parentNodeId);
      scope.occurrences.add(edit.occurrenceId);
    } else if (edit.kind === "supertag-application-create") {
      scope.nodes.add(edit.hostNodeId);
      scope.nodes.add(edit.supertagId);
      addMetanodeReadScope(scope, edit.hostNodeId);
      scope.supertags.add(edit.supertagId);
    } else if (edit.kind === "supertag-remove") {
      scope.nodes.add(edit.hostNodeId);
      scope.nodes.add(edit.supertagId);
      addMetanodeReadScope(scope, edit.hostNodeId);
      scope.supertags.add(edit.supertagId);
    } else if (edit.kind === "inline-reference-alias-create") {
      scope.nodes.add(edit.hostNodeId);
      scope.nodes.add(edit.aliasNodeId);
    } else if (
      edit.kind === "field-datatype-configure" ||
      edit.kind === "field-cardinality-configure" ||
      edit.kind === "field-optionality-configure" ||
      edit.kind === "field-initialization-expression-configure"
    ) {
      scope.nodes.add(edit.fieldDefinitionId);
      if (edit.kind === "field-datatype-configure") {
        scope.nodes.add(edit.datatypeNodeId);
        if (edit.optionsSupertagId !== undefined) {
          scope.nodes.add(edit.optionsSupertagId);
          scope.supertags.add(edit.optionsSupertagId);
        }
      } else if (edit.kind === "field-cardinality-configure") {
        scope.nodes.add(edit.cardinalityNodeId);
      } else if (edit.kind === "field-optionality-configure") {
        scope.nodes.add(edit.optionalityNodeId);
      } else {
        scope.nodes.add(edit.expression.sourceFieldDefinitionId);
      }
    }
  }
  return scope;
}

function addBreadthEditReadScope(scope: GenerationReadScope, edit: EditAction): boolean {
  if (addTypedFieldValueEditReadScope(scope, edit)) {
    return true;
  }
  if (edit.kind === "field-value-create") {
    scope.nodes.add(edit.ownerNodeId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.nodes.add(edit.fieldNodeId);
    scope.nodes.add(edit.valueNodeId);
    scope.occurrences.add(edit.fieldOccurrenceId);
    scope.occurrences.add(edit.valueOccurrenceId);
    scope.childOccurrences.add(edit.ownerNodeId);
    scope.childOccurrences.add(edit.fieldNodeId);
  } else if (edit.kind === "url-node-create") {
    scope.nodes.add(edit.parentNodeId);
    scope.nodes.add(edit.nodeId);
    scope.nodes.add(edit.urlFieldNodeId);
    scope.nodes.add(edit.urlValueNodeId);
    scope.occurrences.add(edit.occurrenceId);
    scope.occurrences.add(edit.urlFieldOccurrenceId);
    scope.occurrences.add(edit.urlValueOccurrenceId);
    scope.childOccurrences.add(edit.parentNodeId);
  } else if (edit.kind === "code-node-configure") {
    scope.nodes.add(edit.nodeId);
    scope.nodes.add(edit.languageFieldNodeId);
    scope.nodes.add(edit.languageValueNodeId);
    scope.occurrences.add(edit.languageFieldOccurrenceId);
    scope.occurrences.add(edit.languageValueOccurrenceId);
    scope.childOccurrences.add(edit.nodeId);
  } else {
    return false;
  }
  return true;
}

function actionReadScope(actions: readonly AuthoredAction[]): GenerationReadScope {
  const scope = emptyGenerationReadScope();
  for (const authoredAction of actions) {
    addRelations(scope, actionRelations(authoredAction));
  }
  return scope;
}

function factActionReadScope(facts: readonly FactAction[]): GenerationReadScope {
  const scope = actionReadScope(facts.map((fact) => fact.action));
  for (const fact of facts) {
    const action = fact.action;
    if (
      action.kind === "search-expression-add" ||
      action.kind === "search-expression-configure" ||
      action.kind === "search-expression-move" ||
      action.kind === "search-expression-remove" ||
      action.kind === "search-expression-restore"
    ) {
      const expressionId = action.kind === "search-expression-add" ? fact.id : action.expressionId;
      scope.nodes.add(searchExpressionProjectionIdentity(expressionId).expressionNodeId);
      continue;
    }
    if (action.kind === "shared-default-view-add") {
      addViewIdentityScope(scope, fact.id);
    } else if (action.kind === "shared-default-view-remove") {
      scope.nodes.add(action.hostNodeId);
    } else if (action.kind === "shared-default-view-restore" || action.kind === "view-mode-set") {
      addViewIdentityScope(scope, action.viewId);
    } else if (action.kind === "view-column-add") {
      addViewIdentityScope(scope, action.viewId);
      scope.nodes.add(viewColumnNodeId(fact.id));
    } else if (action.kind === "view-column-remove") {
      addViewIdentityScope(scope, action.viewId);
    } else if (action.kind === "view-column-move") {
      scope.nodes.add(viewColumnNodeId(action.columnId));
    } else if (action.kind === "view-sort-add") {
      addViewIdentityScope(scope, action.viewId);
      scope.nodes.add(viewSortNodeId(fact.id));
    } else if (action.kind === "view-sort-configure" || action.kind === "view-sort-restore") {
      scope.nodes.add(viewSortNodeId(action.sortId));
    } else if (action.kind === "view-sort-remove") {
      addViewIdentityScope(scope, action.viewId);
    } else if (action.kind === "view-group-add") {
      addViewIdentityScope(scope, action.viewId);
      scope.nodes.add(viewGroupNodeId(fact.id));
    } else if (action.kind === "view-group-remove") {
      addViewIdentityScope(scope, action.viewId);
    } else if (action.kind === "view-filter-add") {
      addViewIdentityScope(scope, action.viewId);
      scope.nodes.add(viewFilterNodeId(fact.id));
    } else if (action.kind === "view-filter-remove") {
      addViewIdentityScope(scope, action.viewId);
    } else if (action.kind === "view-filter-restore") {
      scope.nodes.add(viewFilterNodeId(action.filterId));
    }
  }
  return scope;
}

function addViewIdentityScope(scope: GenerationReadScope, viewId: FactAction["id"]): void {
  const identity = viewProjectionIdentity(viewId);
  scope.nodes.add(identity.attachmentNodeId);
  scope.nodes.add(identity.viewDefinitionNodeId);
  scope.nodes.add(identity.detachedValueNodeId);
}

function addRelations(scope: GenerationReadScope, relations: ReturnType<typeof actionRelations>): void {
  relations.nodeIds.forEach((id) => scope.nodes.add(id));
  relations.occurrenceIds.forEach((id) => scope.occurrences.add(id));
  relations.childrenOfNodeIds.forEach((id) => scope.childOccurrences.add(id));
  relations.supertagIds.forEach((id) => {
    scope.supertags.add(id);
    scope.nodes.add(id);
  });
  relations.instanceSupertagIds.forEach((id) => scope.instanceSupertags.add(id));
  relations.fieldDefinitionIds.forEach((id) => {
    scope.fields.add(id);
    scope.nodes.add(id);
  });
}
