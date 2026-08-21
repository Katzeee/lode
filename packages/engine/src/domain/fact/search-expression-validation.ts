import { assertObject, requireString } from "../../decoding/index.js";
import { parseSearchExpressionSpec } from "./search-expression-spec.js";
import type { Mutation } from "./types.js";

export function assertSearchExpressionMutationShape(value: Record<string, unknown>): void {
  requireString(value.searchNodeId, "Search Node identity");
  requireString(value.expressionNodeId, "Search Expression Node identity");
  requireString(value.expressionOccurrenceId, "Search Expression Occurrence identity");
  requireString(value.definitionOccurrenceId, "Search expression Definition endpoint Occurrence identity");
  assertObject(value.expression, "Search Expression");
  parseSearchExpressionSpec(value.expression);
  if (value.kind === "search-expression-attach" && value.previousExpression !== undefined) {
    assertObject(value.previousExpression, "Previous Search Expression");
    parseSearchExpressionSpec(value.previousExpression);
  }
}

export function validateSearchExpressionMutation(
  mutation: Extract<Mutation, { kind: "search-expression-attach" | "search-expression-detach" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.searchNodeId, "Search Node", factIdentity);
  requireIdentity(mutation.expressionNodeId, "Search Expression Node", factIdentity);
  requireIdentity(mutation.expressionOccurrenceId, "Search Expression Occurrence", factIdentity);
  requireIdentity(mutation.definitionOccurrenceId, "Search expression Definition endpoint Occurrence", factIdentity);
  if (mutation.searchNodeId === mutation.expressionNodeId) {
    throw new Error(`Search Expression cannot be its host: ${factIdentity}`);
  }
  if (mutation.expression.expressionNodeId !== mutation.expressionNodeId) {
    throw new Error(`Search Expression root identity does not match its relation: ${factIdentity}`);
  }
  if (
    mutation.kind === "search-expression-attach" &&
    mutation.previousExpression !== undefined &&
    mutation.previousExpression.expressionNodeId !== mutation.expressionNodeId
  ) {
    throw new Error(`Previous Search Expression root identity does not match its relation: ${factIdentity}`);
  }
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
