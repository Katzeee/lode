import { assertKeys, assertNullableString, assertObject, assertOneOf, requireString } from "../../decoding/index.js";
import { isFactActionId } from "./identities.js";
import { parseSearchClause } from "./search-expression-spec.js";

export function assertSearchExpressionActionShape(value: Record<string, unknown>): void {
  if (value.kind === "search-expression-add") {
    requireString(value.expressionHostId, "Search Expression host identity");
    assertNullableFactActionId(value.parentExpressionId, "parent Search Expression identity");
    parseSearchClause(value.clause);
    assertSequenceAnchor(value.anchor);
    return;
  }
  requireFactActionIdValue(value.expressionId, "Search Expression identity");
  if (value.kind === "search-expression-configure") {
    parseSearchClause(value.clause);
  } else if (value.kind === "search-expression-move") {
    assertNullableFactActionId(value.parentExpressionId, "parent Search Expression identity");
    assertSequenceAnchor(value.anchor);
  }
}

function requireFactActionIdValue(value: unknown, label: string): void {
  if (typeof value !== "string" || !isFactActionId(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertNullableFactActionId(value: unknown, label: string): void {
  if (value !== null) {
    requireFactActionIdValue(value, label);
  }
}

function assertSequenceAnchor(value: unknown): void {
  assertObject(value, "Search Expression anchor");
  assertKeys(value, ["after", "before", "affinity", "fallback"], "Search Expression anchor");
  assertNullableString(value.after, "Search Expression anchor after");
  assertNullableString(value.before, "Search Expression anchor before");
  assertOneOf(value.affinity, ["after", "before"], "Search Expression anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "Search Expression anchor fallback");
}
