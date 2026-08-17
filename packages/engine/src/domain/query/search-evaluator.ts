import { stableStringCompare } from "../fact/index.js";
import type { Projection, SearchExpression } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/index.js";
import type { SearchExpressionSpec, SearchFieldValue, SearchScopeTarget } from "../fact/index.js";

export function evaluateSearchExpression(
  searchNodeId: string,
  expression: SearchExpression | undefined,
  projection: Projection,
): readonly string[] {
  if (
    projection.nodes[searchNodeId]?.intrinsicNodeType !== "search" ||
    nodeLocation(projection.identity.workspaceNodeId, projection, searchNodeId) !== "active" ||
    expression === undefined
  ) {
    return [];
  }
  return evaluateSearchExpressionSpec(expression.expression, projection, searchNodeId);
}

export function evaluateSearchExpressionSpec(
  expression: SearchExpressionSpec,
  projection: Projection,
  relativeScopeHostNodeId?: string,
): readonly string[] {
  return Object.keys(projection.nodes)
    .filter((nodeId) => isSearchableNode(nodeId, projection))
    .filter((nodeId) => matchesExpression(nodeId, relativeScopeHostNodeId, expression, projection))
    .sort(stableStringCompare);
}

export function matchesSearchExpressionSpec(
  nodeId: string,
  expression: SearchExpressionSpec,
  projection: Projection,
  relativeScopeHostNodeId?: string,
): boolean {
  return (
    isSearchableNode(nodeId, projection) && matchesExpression(nodeId, relativeScopeHostNodeId, expression, projection)
  );
}

export function searchResultRowKey(searchNodeId: string, targetNodeId: string): string {
  return `search-result:v1:${encodeURIComponent(searchNodeId)}:${encodeURIComponent(targetNodeId)}`;
}

function matchesExpression(
  nodeId: string,
  relativeScopeHostNodeId: string | undefined,
  expression: SearchExpressionSpec,
  projection: Projection,
): boolean {
  if (expression.kind === "and") {
    return expression.operands.every((operand) =>
      matchesExpression(nodeId, relativeScopeHostNodeId, operand, projection),
    );
  }
  if (expression.kind === "or") {
    return expression.operands.some((operand) =>
      matchesExpression(nodeId, relativeScopeHostNodeId, operand, projection),
    );
  }
  if (expression.kind === "not") {
    return !matchesExpression(nodeId, relativeScopeHostNodeId, expression.operand, projection);
  }
  if (expression.kind === "supertag") {
    const matchingSupertags = new Set(
      projection.supertagInstanceSupertags[expression.supertagId] ?? [expression.supertagId],
    );
    return (projection.supertagApplications[nodeId] ?? []).some((application) =>
      matchingSupertags.has(application.supertagId),
    );
  }
  if (expression.kind === "text") {
    return nodeText(nodeId, projection).toLocaleLowerCase().includes(expression.text.toLocaleLowerCase());
  }
  if (expression.kind === "field-defined") {
    const defined = materializedFields(nodeId, expression.fieldDefinitionId, projection).length > 0;
    return defined === expression.defined;
  }
  if (expression.kind === "field-value") {
    return matchesFieldValue(nodeId, expression.fieldDefinitionId, expression.value, projection);
  }
  if (expression.kind === "date-compare") {
    const dates = (projection.typedFieldValues[nodeId] ?? [])
      .filter(
        (field) =>
          field.fieldDefinitionId === expression.fieldDefinitionId &&
          field.state === "value" &&
          field.value.kind === "date",
      )
      .map((field) => (field.state === "value" && field.value.kind === "date" ? field.value.value : ""));
    return dates.some((date) => (expression.operator === "lt" ? date < expression.date : date > expression.date));
  }
  if (expression.kind === "descendant-of" || expression.kind === "child-of") {
    const targetNodeId = resolveScopeTarget(relativeScopeHostNodeId, expression.target, projection);
    if (targetNodeId === null) {
      return false;
    }
    return expression.kind === "child-of"
      ? projection.nodeOwners[nodeId] === targetNodeId
      : isDescendantOf(nodeId, targetNodeId, projection);
  }
  if (expression.kind === "links-to") {
    return linksTo(nodeId, expression.targetNodeId, projection);
  }
  return false;
}

function materializedFields(nodeId: string, fieldDefinitionId: string, projection: Projection) {
  return (projection.materializedFields[nodeId] ?? []).filter((field) => field.fieldDefinitionId === fieldDefinitionId);
}

function matchesFieldValue(
  nodeId: string,
  fieldDefinitionId: string,
  value: SearchFieldValue,
  projection: Projection,
): boolean {
  const fields = materializedFields(nodeId, fieldDefinitionId, projection);
  const valueNodeIds = fields.flatMap((field) =>
    field.valueOccurrenceIds.flatMap((occurrenceId) => {
      const occurrence = projection.occurrences[occurrenceId];
      return occurrence === undefined ? [] : [occurrence.nodeId];
    }),
  );
  if (value.kind === "node") {
    if (valueNodeIds.includes(value.nodeId)) {
      return true;
    }
    return (projection.typedFieldValues[nodeId] ?? []).some(
      (field) =>
        field.fieldDefinitionId === fieldDefinitionId &&
        field.state === "value" &&
        field.value.kind === "options-from-supertag" &&
        field.value.targetNodeId === value.nodeId,
    );
  }
  if (value.kind === "text") {
    const expected = value.value.toLocaleLowerCase();
    return valueNodeIds.some((valueNodeId) => nodeText(valueNodeId, projection).toLocaleLowerCase() === expected);
  }
  return (projection.typedFieldValues[nodeId] ?? []).some((field) => {
    if (field.fieldDefinitionId !== fieldDefinitionId || field.state !== "value") {
      return false;
    }
    if (value.kind === "number") {
      return field.value.kind === "number" && field.value.value === value.value;
    }
    if (value.kind === "checkbox") {
      return field.value.kind === "checkbox" && field.value.value === value.value;
    }
    return field.value.kind === "date" && field.value.value === value.value;
  });
}

function nodeText(nodeId: string, projection: Projection): string {
  return (projection.nodes[nodeId]?.content ?? [])
    .filter((item) => item.kind === "text")
    .map((item) => item.value)
    .join("");
}

function resolveScopeTarget(
  relativeScopeHostNodeId: string | undefined,
  target: SearchScopeTarget,
  projection: Projection,
): string | null {
  if (target.kind === "node") {
    return target.nodeId;
  }
  if (relativeScopeHostNodeId === undefined) {
    return null;
  }
  const parentNodeId = projection.nodeOwners[relativeScopeHostNodeId] ?? null;
  if (target.kind === "parent" || parentNodeId === null) {
    return parentNodeId;
  }
  return projection.nodeOwners[parentNodeId] ?? null;
}

function isDescendantOf(nodeId: string, targetNodeId: string, projection: Projection): boolean {
  let cursor = projection.nodeOwners[nodeId];
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (cursor === targetNodeId) {
      return true;
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
  return false;
}

function linksTo(nodeId: string, targetNodeId: string, projection: Projection): boolean {
  if (
    (projection.nodes[nodeId]?.content ?? []).some(
      (item) => item.kind === "inline-reference" && item.targetNodeId === targetNodeId,
    )
  ) {
    return true;
  }
  return (projection.childOccurrences[nodeId] ?? []).some((occurrenceId) => {
    const occurrence = projection.occurrences[occurrenceId];
    return occurrence?.nodeId === targetNodeId && projection.nodeOwners[targetNodeId] !== nodeId;
  });
}

function isSearchableNode(nodeId: string, projection: Projection): boolean {
  if (nodeLocation(projection.identity.workspaceNodeId, projection, nodeId) !== "active") {
    return false;
  }
  const metanodes = new Set(Object.values(projection.metanodes));
  let cursor: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (metanodes.has(cursor)) {
      return false;
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
  const ownerNodeId = projection.nodeOwners[nodeId];
  return (
    ownerNodeId !== null &&
    ownerNodeId !== undefined &&
    Object.values(projection.occurrences).some(
      (occurrence) => !occurrence.derived && occurrence.nodeId === nodeId && occurrence.parentNodeId === ownerNodeId,
    )
  );
}
