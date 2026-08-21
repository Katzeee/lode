import type { EditMutation, MutationWrite } from "../../../domain/edit/index.js";
import {
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  canonicalJson,
  searchExpressionNodeIds,
  type SearchExpressionSpec,
  visitSearchExpression,
} from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { endpoint, nonemptyAtomicWrite, prepareMetanodeCreation } from "./relation-planning-support.js";

export function prepareSearchExpressionCreation(
  edit: Extract<EditMutation, { kind: "search-expression-create" }>,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.searchNodeId]?.intrinsicNodeType !== "search") {
    throw new Error("Search Expression host is not an active Search Node");
  }
  if (available.nodes[edit.expressionNodeId] !== undefined) {
    throw new Error("Search Expression Node identity already exists");
  }
  if (available.searchExpressions[edit.searchNodeId] !== undefined) {
    throw new Error("Search Node already has a Search Expression");
  }
  validateSearchExpression(edit.searchNodeId, edit.expressionNodeId, edit.expression, available);
  return nonemptyAtomicWrite(
    [
      ...prepareMetanodeCreation(edit.searchNodeId, edit.metanodeId, available, "Search"),
      { kind: "node-create", nodeId: edit.expressionNodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
      {
        kind: "node-owner-set",
        nodeId: edit.expressionNodeId,
        ownerNodeId: edit.metanodeId,
        previousOwnerNodeId: null,
      },
      {
        kind: "occurrence-create",
        occurrenceId: edit.expressionOccurrenceId,
        nodeId: edit.expressionNodeId,
        parentNodeId: edit.metanodeId,
        anchor: edit.anchor,
      },
      endpoint(edit.definitionOccurrenceId, SEARCH_EXPRESSION_DEFINITION_NODE_ID, edit.expressionNodeId),
      {
        kind: "search-expression-attach",
        searchNodeId: edit.searchNodeId,
        expressionNodeId: edit.expressionNodeId,
        expressionOccurrenceId: edit.expressionOccurrenceId,
        definitionOccurrenceId: edit.definitionOccurrenceId,
        expression: edit.expression,
      },
    ],
    "Search Expression",
  );
}

export function prepareSearchExpressionUpdate(
  edit: Extract<EditMutation, { kind: "search-expression-update" }>,
  available: ScopedProjection,
): MutationWrite {
  const current = available.searchExpressions[edit.searchNodeId];
  if (current === undefined) {
    throw new Error("Search Node has no Search Expression");
  }
  validateSearchExpression(edit.searchNodeId, current.expressionNodeId, edit.expression, available);
  if (canonicalJson(current.expression) === canonicalJson(edit.expression)) {
    throw new Error("Search Expression update has no effect");
  }
  return nonemptyAtomicWrite(
    [
      {
        kind: "search-expression-attach",
        searchNodeId: edit.searchNodeId,
        expressionNodeId: current.expressionNodeId,
        expressionOccurrenceId: current.expressionOccurrenceId,
        definitionOccurrenceId: current.definitionOccurrenceId,
        expression: edit.expression,
        previousExpression: current.expression,
      },
    ],
    "Search Expression update",
  );
}

export function validateSearchExpressionTargets(expression: SearchExpressionSpec, available: ScopedProjection): void {
  visitSearchExpression(expression, (candidate) => {
    if (candidate.kind === "supertag") {
      if (available.nodes[candidate.supertagId]?.intrinsicNodeType !== "supertag-definition") {
        throw new Error("Search Expression Supertag is not active");
      }
    } else if (
      candidate.kind === "field-defined" ||
      candidate.kind === "field-value" ||
      candidate.kind === "date-compare"
    ) {
      validateFieldTarget(candidate, available);
    } else if (
      (candidate.kind === "descendant-of" || candidate.kind === "child-of") &&
      candidate.target.kind === "node" &&
      available.nodes[candidate.target.nodeId] === undefined
    ) {
      throw new Error("Search Expression scope target is not active");
    } else if (candidate.kind === "links-to" && available.nodes[candidate.targetNodeId] === undefined) {
      throw new Error("Search Expression links-to target is not active");
    }
  });
}

function validateSearchExpression(
  searchNodeId: string,
  expressionNodeId: string,
  expression: SearchExpressionSpec,
  available: ScopedProjection,
): void {
  if (expression.expressionNodeId !== expressionNodeId) {
    throw new Error("Search Expression root identity does not match its relation");
  }
  const current = available.searchExpressions[searchNodeId];
  const currentIds = new Set(current === undefined ? [] : searchExpressionNodeIds(current.expression));
  const usedByOtherSearch = new Set(
    Object.entries(available.searchExpressions)
      .filter(([candidateSearchNodeId]) => candidateSearchNodeId !== searchNodeId)
      .flatMap(([, candidate]) => searchExpressionNodeIds(candidate.expression)),
  );
  for (const identity of searchExpressionNodeIds(expression)) {
    if (usedByOtherSearch.has(identity) || (available.nodes[identity] !== undefined && !currentIds.has(identity))) {
      throw new Error(`Search Expression Node identity already exists: ${identity}`);
    }
  }
  validateSearchExpressionTargets(expression, available);
}

function validateFieldTarget(
  candidate: Extract<SearchExpressionSpec, { kind: "field-defined" | "field-value" | "date-compare" }>,
  available: ScopedProjection,
): void {
  if (available.nodes[candidate.fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
    throw new Error("Search Expression Field Definition is not active");
  }
  if (
    candidate.kind === "field-value" &&
    candidate.value.kind === "node" &&
    available.nodes[candidate.value.nodeId] === undefined
  ) {
    throw new Error("Search Expression Field value Node is not active");
  }
}
