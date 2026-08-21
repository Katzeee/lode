import type { EditMutation } from "../../../domain/edit/index.js";
import { type SearchExpressionSpec, visitSearchExpression } from "../../../domain/fact/index.js";
import type { GenerationReadScope } from "./read-scope.js";

export function addSearchViewEditReadScope(scope: GenerationReadScope, edit: EditMutation): boolean {
  if (edit.kind === "search-expression-create") {
    scope.nodes.add(edit.searchNodeId);
    scope.nodes.add(edit.metanodeId);
    scope.nodes.add(edit.expressionNodeId);
    scope.childOccurrences.add(edit.metanodeId);
    addSearchExpressionReadScope(scope, edit.expression);
  } else if (edit.kind === "search-expression-update") {
    scope.nodes.add(edit.searchNodeId);
    addSearchExpressionReadScope(scope, edit.expression);
  } else if (edit.kind === "shared-default-view-definition-create") {
    scope.nodes.add(edit.hostNodeId);
    scope.nodes.add(edit.metanodeId);
    scope.nodes.add(edit.attachmentNodeId);
    scope.nodes.add(edit.viewDefinitionNodeId);
    scope.occurrences.add(edit.attachmentOccurrenceId);
    scope.occurrences.add(edit.viewDefinitionOccurrenceId);
    scope.childOccurrences.add(edit.metanodeId);
    scope.childOccurrences.add(edit.attachmentNodeId);
  } else if (edit.kind === "shared-default-view-definition-remove") {
    scope.nodes.add(edit.hostNodeId);
    scope.nodes.add(edit.attachmentNodeId);
    scope.nodes.add(edit.viewDefinitionNodeId);
    scope.occurrences.add(edit.attachmentOccurrenceId);
    scope.occurrences.add(edit.relationDefinitionOccurrenceId);
    scope.occurrences.add(edit.viewDefinitionOccurrenceId);
    scope.childOccurrences.add(edit.attachmentNodeId);
  } else if (edit.kind === "shared-default-view-definition-options-update") {
    addViewOptionsReadScope(scope, edit);
  } else {
    return false;
  }
  return true;
}

function addViewOptionsReadScope(
  scope: GenerationReadScope,
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-options-update" }>,
): void {
  scope.nodes.add(edit.hostNodeId);
  scope.nodes.add(edit.viewDefinitionNodeId);
  for (const column of edit.options.columns) {
    addField(scope, column.fieldDefinitionId);
  }
  if (edit.options.sort !== null) {
    addField(scope, edit.options.sort.fieldDefinitionId);
  }
  if (edit.options.group !== null) {
    addField(scope, edit.options.group.fieldDefinitionId);
  }
  if (edit.options.filter !== null) {
    addSearchExpressionReadScope(scope, edit.options.filter.expression);
  }
}

function addSearchExpressionReadScope(scope: GenerationReadScope, expression: SearchExpressionSpec): void {
  visitSearchExpression(expression, (candidate) => {
    if (candidate.kind === "supertag") {
      scope.nodes.add(candidate.supertagId);
      scope.supertags.add(candidate.supertagId);
    } else if (
      candidate.kind === "field-defined" ||
      candidate.kind === "field-value" ||
      candidate.kind === "date-compare"
    ) {
      addField(scope, candidate.fieldDefinitionId);
      if (candidate.kind === "field-value" && candidate.value.kind === "node") {
        scope.nodes.add(candidate.value.nodeId);
      }
    } else if (
      (candidate.kind === "descendant-of" || candidate.kind === "child-of") &&
      candidate.target.kind === "node"
    ) {
      scope.nodes.add(candidate.target.nodeId);
    } else if (candidate.kind === "links-to") {
      scope.nodes.add(candidate.targetNodeId);
    }
  });
}

function addField(scope: GenerationReadScope, fieldDefinitionId: string): void {
  scope.nodes.add(fieldDefinitionId);
  scope.fields.add(fieldDefinitionId);
}
