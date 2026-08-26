import type { InvocationOutcome as ProtocolInvocationOutcome } from "@lode/protocol/dto/engine";
import {
  ConflictIssueSchema,
  DecisionEffectSchema,
  ReviewQueryResultSchema,
  ReviewSelectionSchema,
} from "@lode/protocol/proto";
import type { InvocationOutcome } from "./contract.js";
import type { FieldInitializationExpression, PreviousValue } from "./model.js";
import type { ConflictIssue, DecisionEffect, ReviewQuery, ReviewSelection } from "./review.js";
import {
  conflictIssueKind,
  decisionEffectKind,
  protocolConflictIssueCase,
  protocolDecisionEffectCase,
  type ProtocolConflictIssueCase,
  type ProtocolDecisionEffectCase,
} from "./protocol-cases.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { fromViewOptionsSpec, toViewOptionsSpec } from "./protocol-view-options-codec.js";
import { fromSearchClause, toSearchClause } from "./protocol-search-expression-codec.js";

export function toReviewSelection(selection: ReviewSelection): Record<string, unknown> {
  return toProtocolMessage(ReviewSelectionSchema, toProtocolValue(selection)) as Record<string, unknown>;
}

export function fromReviewSelection(value: unknown): ReviewSelection {
  return fromProtocolValue(fromProtocolMessage(ReviewSelectionSchema, value)) as ReviewSelection;
}

export function toReviewQuery(value: ReviewQuery): Record<string, unknown> {
  const result = toProtocolValue(value) as Record<string, unknown>;
  result.hunks = value.hunks.map((hunk) => ({
    ...(toProtocolValue(hunk) as Record<string, unknown>),
    evidence: {
      ...(toProtocolValue(hunk.evidence) as Record<string, unknown>),
      effects: hunk.evidence.effects.map(toDecisionEffect),
    },
    selection: toReviewSelection(hunk.selection),
  }));
  return toProtocolMessage(ReviewQueryResultSchema, result) as Record<string, unknown>;
}

export function fromReviewQuery(value: unknown): ReviewQuery {
  const decoded = fromProtocolMessage(ReviewQueryResultSchema, value) as Record<string, unknown>;
  const result = fromProtocolValue(decoded) as Record<string, unknown>;
  result.hunks = (result.hunks as readonly Record<string, unknown>[]).map((hunk) => {
    const evidence = required(hunk.evidence as Record<string, unknown> | null, "Review evidence");
    return {
      ...hunk,
      evidence: {
        ...evidence,
        effects: (evidence.effects as readonly unknown[]).map(fromDecisionEffect),
      },
      selection: fromReviewSelection(hunk.selection),
    };
  });
  return result as ReviewQuery;
}

function toDecisionEffect(effect: DecisionEffect): Record<string, unknown> {
  const value = toProtocolValue(effect) as Record<string, unknown>;
  delete value.kind;
  if (effect.kind === "field-definition-configuration") {
    value.origin = fieldDefinitionConfigurationStateToProtocol(effect.origin);
    value.review = fieldDefinitionConfigurationStateToProtocol(effect.review);
  }
  if (effect.kind === "view-definition") {
    value.origin = viewDefinitionStateToProtocol(effect.origin);
    value.review = viewDefinitionStateToProtocol(effect.review);
  }
  if (effect.kind === "search-expression") {
    value.origin = searchExpressionStateToProtocol(effect.origin);
    value.review = searchExpressionStateToProtocol(effect.review);
  }
  const wrapped = { effect: { $case: protocolDecisionEffectCase(effect.kind), value } };
  return toProtocolMessage(DecisionEffectSchema, wrapped) as Record<string, unknown>;
}

function fromDecisionEffect(value: unknown): DecisionEffect {
  const decodedMessage = fromProtocolMessage(DecisionEffectSchema, value) as Record<string, unknown>;
  const selected = required(
    (decodedMessage as { effect?: { $case: ProtocolDecisionEffectCase; value: unknown } | null }).effect,
    "Decision effect",
  );
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.$case === "fieldDefinitionConfiguration") {
    decoded.origin = fieldDefinitionConfigurationStateFromProtocol(decoded.origin);
    decoded.review = fieldDefinitionConfigurationStateFromProtocol(decoded.review);
  }
  if (selected.$case === "viewDefinition") {
    decoded.origin = viewDefinitionStateFromProtocol(decoded.origin);
    decoded.review = viewDefinitionStateFromProtocol(decoded.review);
  }
  if (selected.$case === "searchExpression") {
    decoded.origin = searchExpressionStateFromProtocol(decoded.origin);
    decoded.review = searchExpressionStateFromProtocol(decoded.review);
  }
  return { ...decoded, kind: decisionEffectKind(selected.$case) } as DecisionEffect;
}

function searchExpressionStateToProtocol(
  state: Extract<DecisionEffect, { kind: "search-expression" }>["origin"],
): unknown {
  return state === null ? null : { ...state, clause: state.clause === null ? null : toSearchClause(state.clause) };
}

function searchExpressionStateFromProtocol(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const state = value as Record<string, unknown>;
  return { ...state, clause: state.clause === null ? null : fromSearchClause(state.clause) };
}

function viewDefinitionStateToProtocol(state: Extract<DecisionEffect, { kind: "view-definition" }>["origin"]): unknown {
  return state === null ? null : { ...state, options: toViewOptionsSpec(state.options) };
}

function viewDefinitionStateFromProtocol(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const state = value as Record<string, unknown>;
  return { ...state, options: fromViewOptionsSpec(state.options) };
}

function fieldDefinitionConfigurationStateToProtocol(
  state: Extract<DecisionEffect, { kind: "field-definition-configuration" }>["origin"],
): unknown {
  if (state === null) {
    return null;
  }
  if (state.kind === "datatype") {
    return { configuration: { $case: "datatypeNodeId", value: state.datatypeNodeId } };
  }
  if (state.kind === "cardinality") {
    return { configuration: { $case: "cardinalityNodeId", value: state.cardinalityNodeId } };
  }
  if (state.kind === "optionality") {
    return { configuration: { $case: "optionalityNodeId", value: state.optionalityNodeId } };
  }
  return {
    configuration: {
      $case: "initializationExpression",
      value: withoutExpressionKind(state.expression),
    },
  };
}

function fieldDefinitionConfigurationStateFromProtocol(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const state = value as Record<string, unknown>;
  const selected = required(
    (state as { configuration?: { $case: string; value: unknown } | null }).configuration,
    "Field Definition configuration state",
  );
  if (selected.$case === "datatypeNodeId") {
    return { kind: "datatype", datatypeNodeId: selected.value };
  }
  if (selected.$case === "cardinalityNodeId") {
    return { kind: "cardinality", cardinalityNodeId: selected.value };
  }
  if (selected.$case === "optionalityNodeId") {
    return { kind: "optionality", optionalityNodeId: selected.value };
  }
  if (selected.$case === "initializationExpression") {
    const expression = selected.value as Record<string, unknown>;
    return {
      kind: "initialization-expression",
      expression: { kind: "find-field-values", ...expression },
    };
  }
  throw new Error(`Unknown Field Definition configuration state: ${selected.$case}`);
}

function withoutExpressionKind(expression: FieldInitializationExpression): Record<string, unknown> {
  const { kind: _kind, ...value } = expression;
  return value;
}

export function toConflictIssue(issue: ConflictIssue): Record<string, unknown> {
  const value = toProtocolValue(issue) as Record<string, unknown>;
  delete value.kind;
  const wrapped = { issue: { $case: protocolConflictIssueCase(issue.kind), value } };
  return toProtocolMessage(ConflictIssueSchema, wrapped) as Record<string, unknown>;
}

export function fromConflictIssue(value: unknown): ConflictIssue {
  const decodedMessage = fromProtocolMessage(ConflictIssueSchema, value) as Record<string, unknown>;
  const selected = required(
    (decodedMessage as { issue?: { $case: ProtocolConflictIssueCase; value: unknown } | null }).issue,
    "Conflict issue",
  );
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  return { ...decoded, kind: conflictIssueKind(selected.$case) } as ConflictIssue;
}

export function toInvocationOutcome(value: InvocationOutcome): Record<string, unknown> {
  return {
    result: {
      $case: value.status === "committed-projection-pending" ? "committedProjectionPending" : value.status,
      value: toProtocolValue(value),
    },
  };
}

export function fromInvocationOutcome(value: ProtocolInvocationOutcome): InvocationOutcome {
  const selected = required(value.result, "Invocation outcome");
  const status = selected.$case === "committedProjectionPending" ? "committed-projection-pending" : selected.$case;
  return { ...(fromProtocolValue(selected.value) as Record<string, unknown>), status } as InvocationOutcome;
}

export function toProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toProtocolValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isPreviousValue(value)) {
    return value.kind === "unset"
      ? { state: { $case: "unset", value: {} } }
      : { state: { $case: "set", value: value.value } };
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toProtocolValue(item)]));
}

export function fromProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(fromProtocolValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isProtocolPreviousValue(value)) {
    return value.state.$case === "unset"
      ? { kind: "unset" }
      : { kind: "set", value: fromProtocolValue(value.state.value) };
  }
  if ("issue" in value && value.issue !== null) {
    return fromConflictIssue(value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromProtocolValue(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function required<Value>(value: Value | null | undefined, label: string): Value {
  if (value === null || value === undefined) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function isPreviousValue(value: Record<string, unknown>): value is PreviousValue {
  return value.kind === "unset" || (value.kind === "set" && "value" in value);
}

function isProtocolPreviousValue(
  value: Record<string, unknown>,
): value is { state: { $case: "unset" | "set"; value: unknown } } {
  return (
    isRecord(value.state) && (value.state.$case === "unset" || value.state.$case === "set") && "value" in value.state
  );
}
