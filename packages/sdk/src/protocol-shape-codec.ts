import type { InvocationOutcome as ProtocolInvocationOutcome } from "@lode/protocol/dto/engine";
import {
  ConflictIssueSchema,
  DecisionEffectSchema,
  SupertagFieldConfigSchema,
  ReviewQueryResultSchema,
  ReviewSelectionSchema,
} from "@lode/protocol/proto";
import type { InvocationOutcome } from "./contract.js";
import type { SupertagFieldConfig, FieldValueSeed, PreviousValue } from "./model.js";
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

export function toReviewSelection(selection: ReviewSelection): Record<string, unknown> {
  const value = toProtocolValue(selection) as Record<string, unknown>;
  value.evidence = {
    ...(toProtocolValue(selection.evidence) as Record<string, unknown>),
    effects: selection.evidence.effects.map(toDecisionEffect),
  };
  return toProtocolMessage(ReviewSelectionSchema, value) as Record<string, unknown>;
}

export function fromReviewSelection(value: unknown): ReviewSelection {
  const decoded = fromProtocolMessage(ReviewSelectionSchema, value) as Record<string, unknown>;
  const selection = fromProtocolValue(decoded) as Record<string, unknown>;
  const evidence = required(selection.evidence as Record<string, unknown> | null, "Review evidence");
  selection.evidence = {
    ...evidence,
    effects: (evidence.effects as readonly unknown[]).map(fromDecisionEffect),
  };
  return selection as ReviewSelection;
}

export function toReviewQuery(value: ReviewQuery): Record<string, unknown> {
  const result = toProtocolValue(value) as Record<string, unknown>;
  result.hunks = value.hunks.map((hunk) => ({
    ...(toProtocolValue(hunk) as Record<string, unknown>),
    selection: toReviewSelection(hunk.selection),
  }));
  return toProtocolMessage(ReviewQueryResultSchema, result) as Record<string, unknown>;
}

export function fromReviewQuery(value: unknown): ReviewQuery {
  const decoded = fromProtocolMessage(ReviewQueryResultSchema, value) as Record<string, unknown>;
  const result = fromProtocolValue(decoded) as Record<string, unknown>;
  result.hunks = (result.hunks as readonly Record<string, unknown>[]).map((hunk) => ({
    ...hunk,
    selection: fromReviewSelection(hunk.selection),
  }));
  return result as ReviewQuery;
}

function toDecisionEffect(effect: DecisionEffect): Record<string, unknown> {
  const value = toProtocolValue(effect) as Record<string, unknown>;
  delete value.kind;
  if (effect.kind === "field-configuration") {
    value.origin = effect.origin === null ? null : toSupertagFieldConfig(effect.origin);
    value.review = effect.review === null ? null : toSupertagFieldConfig(effect.review);
  } else if (effect.kind === "field-definition-configuration") {
    value.origin = fieldDefinitionConfigurationStateToProtocol(effect.origin);
    value.review = fieldDefinitionConfigurationStateToProtocol(effect.review);
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
  if (selected.$case === "fieldConfiguration") {
    decoded.origin = decoded.origin === null ? null : fromSupertagFieldConfig(decoded.origin);
    decoded.review = decoded.review === null ? null : fromSupertagFieldConfig(decoded.review);
  } else if (selected.$case === "fieldDefinitionConfiguration") {
    decoded.origin = fieldDefinitionConfigurationStateFromProtocol(decoded.origin);
    decoded.review = fieldDefinitionConfigurationStateFromProtocol(decoded.review);
  }
  return { ...decoded, kind: decisionEffectKind(selected.$case) } as DecisionEffect;
}

function fieldDefinitionConfigurationStateToProtocol(
  state: Extract<DecisionEffect, { kind: "field-definition-configuration" }>["origin"],
): unknown {
  if (state === null) {
    return null;
  }
  if (state.kind === "datatype") {
    return { configuration: { $case: "datatype", value: state.datatype } };
  }
  if (state.kind === "cardinality") {
    return { configuration: { $case: "cardinality", value: state.cardinality } };
  }
  return {
    configuration: {
      $case: "initializationExpression",
      value: { sourceFieldDefinitionId: state.expression.sourceFieldDefinitionId },
    },
  };
}

function fieldDefinitionConfigurationStateFromProtocol(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const selected = required(
    (value as { configuration?: { $case: string; value: unknown } | null }).configuration,
    "Field Definition configuration state",
  );
  if (selected.$case === "datatype") {
    return { kind: "datatype", datatype: selected.value };
  }
  if (selected.$case === "cardinality") {
    return { kind: "cardinality", cardinality: selected.value };
  }
  if (selected.$case === "initializationExpression") {
    const expression = selected.value as Record<string, unknown>;
    return {
      kind: "initialization-expression",
      expression: {
        kind: "ancestor-field-values",
        sourceFieldDefinitionId: expression.sourceFieldDefinitionId,
      },
    };
  }
  throw new Error(`Unknown Field Definition configuration state: ${selected.$case}`);
}

export function toConflictIssue(issue: ConflictIssue): Record<string, unknown> {
  const value = toProtocolValue(issue) as Record<string, unknown>;
  delete value.kind;
  if (issue.kind === "field-config-conflict") {
    value.candidates = issue.candidates.map((candidate) => ({
      ...candidate,
      config: toSupertagFieldConfig(candidate.config),
    }));
  } else if (issue.kind === "field-initialization-conflict") {
    value.candidates = issue.candidates.map((candidate) => ({
      ...candidate,
      values: candidate.values.map(toFieldValueSeed),
    }));
  }
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
  if (selected.$case === "fieldConfigConflict") {
    decoded.candidates = (decoded.candidates as readonly Record<string, unknown>[]).map((candidate) => ({
      ...candidate,
      config: fromSupertagFieldConfig(candidate.config),
    }));
  } else if (selected.$case === "fieldInitializationConflict") {
    decoded.candidates = (decoded.candidates as readonly Record<string, unknown>[]).map((candidate) => ({
      ...candidate,
      values: (candidate.values as readonly unknown[]).map(fromFieldValueSeed),
    }));
  }
  return { ...decoded, kind: conflictIssueKind(selected.$case) } as ConflictIssue;
}

export function toSupertagFieldConfig(config: SupertagFieldConfig): Record<string, unknown> {
  const value = {
    visibility: config.visibility,
    staticDefault: config.staticDefault === null ? null : { values: config.staticDefault.map(toFieldValueSeed) },
  };
  return toProtocolMessage(SupertagFieldConfigSchema, value) as Record<string, unknown>;
}

export function fromSupertagFieldConfig(value: unknown): SupertagFieldConfig {
  const config = required(
    fromProtocolMessage(SupertagFieldConfigSchema, value) as Record<string, unknown> | null,
    "Field template config",
  );
  return {
    visibility: config.visibility,
    staticDefault:
      config.staticDefault === null
        ? null
        : (config.staticDefault as { values: readonly unknown[] }).values.map(fromFieldValueSeed),
  } as SupertagFieldConfig;
}

export function toFieldValueSeed(seed: FieldValueSeed): Record<string, unknown> {
  return seed.kind === "text"
    ? { seed: { $case: "text", value: seed.value } }
    : { seed: { $case: "reference", value: seed.nodeId } };
}

export function fromFieldValueSeed(value: unknown): FieldValueSeed {
  const selected = required(
    (value as { seed?: { $case: "text" | "reference"; value: string } | null }).seed,
    "Field value seed",
  );
  return selected.$case === "text"
    ? { kind: "text", value: selected.value }
    : { kind: "reference", nodeId: selected.value };
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

export function isRecord(value: unknown): value is Record<string, unknown> {
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
