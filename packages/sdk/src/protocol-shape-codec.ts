import type { InvocationOutcome as ProtocolInvocationOutcome } from "@lode/protocol/proto";
import { DecisionEffectSchema, ReviewQueryResultSchema, ReviewSelectionSchema } from "@lode/protocol/proto";
import type { InvocationOutcome } from "./contract.js";
import type { FieldInitializationExpression } from "./model.js";
import type { DecisionEffect, ReviewQuery, ReviewSelection } from "./review.js";
import { decisionEffectKind, protocolDecisionEffectCase, type ProtocolDecisionEffectCase } from "./protocol-cases.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { required, selectedCase, unsupportedProtocolCase, unsupportedProtocolValue } from "./protocol-decoding.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { fromPreviousValue, toPreviousValue } from "./protocol-previous-value-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";
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
  if (effect.kind === "text") {
    value.markChanges = effect.markChanges.map((change) => ({
      ...(toProtocolValue(change) as Record<string, unknown>),
      origin: toPreviousValue(change.origin),
      review: toPreviousValue(change.review),
    }));
  }
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
  const wrapped = { effect: { case: protocolDecisionEffectCase(effect.kind), value } };
  return toProtocolMessage(DecisionEffectSchema, wrapped) as Record<string, unknown>;
}

function fromDecisionEffect(value: unknown): DecisionEffect {
  const decodedMessage = fromProtocolMessage(DecisionEffectSchema, value) as Record<string, unknown>;
  const selected = selectedCase(
    (
      decodedMessage as {
        effect?: { case: ProtocolDecisionEffectCase; value: unknown } | { case: undefined } | null;
      }
    ).effect,
    "Decision effect",
  );
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.case === "text") {
    decoded.markChanges = (decoded.markChanges as readonly Record<string, unknown>[]).map((change) => ({
      ...change,
      origin: fromPreviousValue(change.origin),
      review: fromPreviousValue(change.review),
    }));
  }
  if (selected.case === "fieldDefinitionConfiguration") {
    decoded.origin = fieldDefinitionConfigurationStateFromProtocol(decoded.origin);
    decoded.review = fieldDefinitionConfigurationStateFromProtocol(decoded.review);
  }
  if (selected.case === "viewDefinition") {
    decoded.origin = viewDefinitionStateFromProtocol(decoded.origin);
    decoded.review = viewDefinitionStateFromProtocol(decoded.review);
  }
  if (selected.case === "searchExpression") {
    decoded.origin = searchExpressionStateFromProtocol(decoded.origin);
    decoded.review = searchExpressionStateFromProtocol(decoded.review);
  }
  return { ...decoded, kind: decisionEffectKind(selected.case) } as DecisionEffect;
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
    return { configuration: { case: "datatypeNodeId", value: state.datatypeNodeId } };
  }
  if (state.kind === "cardinality") {
    return { configuration: { case: "cardinalityNodeId", value: state.cardinalityNodeId } };
  }
  if (state.kind === "optionality") {
    return { configuration: { case: "optionalityNodeId", value: state.optionalityNodeId } };
  }
  return {
    configuration: {
      case: "initializationExpression",
      value: withoutExpressionKind(state.expression),
    },
  };
}

function fieldDefinitionConfigurationStateFromProtocol(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const state = value as Record<string, unknown>;
  const selected = selectedCase(
    (
      state as {
        configuration?: { case: string; value: unknown } | { case: undefined } | null;
      }
    ).configuration,
    "Field Definition configuration state",
  );
  if (selected.case === "datatypeNodeId") {
    return { kind: "datatype", datatypeNodeId: selected.value };
  }
  if (selected.case === "cardinalityNodeId") {
    return { kind: "cardinality", cardinalityNodeId: selected.value };
  }
  if (selected.case === "optionalityNodeId") {
    return { kind: "optionality", optionalityNodeId: selected.value };
  }
  if (selected.case === "initializationExpression") {
    const expression = selected.value as Record<string, unknown>;
    return {
      kind: "initialization-expression",
      expression: { kind: "find-field-values", ...expression },
    };
  }
  throw new Error(`Unknown Field Definition configuration state: ${selected.case}`);
}

function withoutExpressionKind(expression: FieldInitializationExpression): Record<string, unknown> {
  const { kind: _kind, ...value } = expression;
  return value;
}

export function toInvocationOutcome(value: InvocationOutcome): Record<string, unknown> {
  switch (value.status) {
    case "absent":
      return { result: { case: "absent", value: {} } };
    case "published":
      return { result: { case: "published", value: toProtocolValue(withoutStatus(value)) } };
    case "committed-projection-pending":
      return {
        result: {
          case: "committedProjectionPending",
          value: toProtocolValue(withoutStatus(value)),
        },
      };
    default:
      return unsupportedProtocolValue(value, "Invocation outcome");
  }
}

export function fromInvocationOutcome(value: ProtocolDto<ProtocolInvocationOutcome>): InvocationOutcome {
  const selected = selectedCase(value.result, "Invocation outcome");
  switch (selected.case) {
    case "absent":
      return { status: "absent" };
    case "published":
      return {
        ...(fromProtocolValue(selected.value) as Record<string, unknown>),
        status: "published",
      } as InvocationOutcome;
    case "committedProjectionPending":
      return {
        ...(fromProtocolValue(selected.value) as Record<string, unknown>),
        status: "committed-projection-pending",
      } as InvocationOutcome;
    default:
      return unsupportedProtocolCase(selected, "Invocation outcome");
  }
}

function withoutStatus<Value extends InvocationOutcome>(value: Value): Omit<Value, "status"> {
  const { status: _status, ...body } = value;
  return body;
}
