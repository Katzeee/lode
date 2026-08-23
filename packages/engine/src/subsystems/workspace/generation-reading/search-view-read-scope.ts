import type { EditAction } from "../../../domain/edit/index.js";
import { type SearchClause, type SearchExpressionDraft } from "../../../domain/fact/index.js";
import { addMetanodeReadScope, type GenerationReadScope } from "./read-scope.js";

export function addSearchViewEditReadScope(scope: GenerationReadScope, edit: EditAction): boolean {
  if (edit.kind === "search-expression-create") {
    scope.nodes.add(edit.searchNodeId);
    addMetanodeReadScope(scope, edit.searchNodeId);
    visitSearchExpressionDraft(edit.expression, (clause) => addSearchClauseReadScope(scope, clause));
  } else if (
    edit.kind === "search-expression-add" ||
    edit.kind === "search-expression-configure" ||
    edit.kind === "search-expression-move" ||
    edit.kind === "search-expression-remove"
  ) {
    scope.nodes.add(edit.searchNodeId);
    addMetanodeReadScope(scope, edit.searchNodeId);
    if (edit.kind === "search-expression-add") {
      visitSearchExpressionDraft(edit.expression, (clause) => addSearchClauseReadScope(scope, clause));
    } else if (edit.kind === "search-expression-configure") {
      addSearchClauseReadScope(scope, edit.clause);
    }
  } else if (
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
    edit.kind === "view-filter-expression-remove"
  ) {
    scope.nodes.add(edit.hostNodeId);
    addMetanodeReadScope(scope, edit.hostNodeId);
    if (edit.kind === "view-sort-by-node-name") {
      scope.childOccurrences.add(edit.hostNodeId);
    }
    if (
      edit.kind === "view-column-add" ||
      edit.kind === "view-column-remove" ||
      edit.kind === "view-sort-add" ||
      edit.kind === "view-sort-configure" ||
      edit.kind === "view-group-add"
    ) {
      addField(scope, edit.fieldDefinitionId);
    }
    if (edit.kind === "view-filter-create") {
      visitSearchExpressionDraft(edit.expression, (clause) => addSearchClauseReadScope(scope, clause));
    } else if (edit.kind === "view-filter-expression-add") {
      visitSearchExpressionDraft(edit.expression, (clause) => addSearchClauseReadScope(scope, clause));
    } else if (edit.kind === "view-filter-expression-configure") {
      addSearchClauseReadScope(scope, edit.clause);
    }
  } else {
    return false;
  }
  return true;
}

function visitSearchExpressionDraft(expression: SearchExpressionDraft, visit: (clause: SearchClause) => void): void {
  if (expression.kind === "and" || expression.kind === "or") {
    visit({ kind: expression.kind });
    expression.operands.forEach((operand) => visitSearchExpressionDraft(operand, visit));
  } else if (expression.kind === "not") {
    visit({ kind: "not" });
    visitSearchExpressionDraft(expression.operand, visit);
  } else {
    visit(expression);
  }
}

function addSearchClauseReadScope(scope: GenerationReadScope, clause: SearchClause): void {
  if (clause.kind === "supertag") {
    scope.nodes.add(clause.supertagId);
    scope.supertags.add(clause.supertagId);
  } else if (clause.kind === "field-defined" || clause.kind === "field-value" || clause.kind === "date-compare") {
    addField(scope, clause.fieldDefinitionId);
    if (clause.kind === "field-value" && clause.value.kind === "node") {
      scope.nodes.add(clause.value.nodeId);
    }
  } else if ((clause.kind === "descendant-of" || clause.kind === "child-of") && clause.target.kind === "node") {
    scope.nodes.add(clause.target.nodeId);
  } else if (clause.kind === "links-to") {
    scope.nodes.add(clause.targetNodeId);
  }
}

function addField(scope: GenerationReadScope, fieldDefinitionId: string): void {
  scope.nodes.add(fieldDefinitionId);
  scope.fields.add(fieldDefinitionId);
}
