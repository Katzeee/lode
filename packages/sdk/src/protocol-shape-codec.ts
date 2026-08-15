import type { InvocationOutcome as ProtocolInvocationOutcome } from "@lode/protocol/dto/engine";
import {
  ConflictIssueSchema,
  DecisionEffectSchema,
  FieldTemplateConfigSchema,
  ReviewQueryResultSchema,
  ReviewSelectionSchema,
} from "@lode/protocol/proto";
import type { InvocationOutcome } from "./contract.js";
import type { FieldTemplateConfig, FieldValueSeed, PreviousValue } from "./model.js";
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
  if (effect.kind === "value") {
    delete value.targetKind;
    delete value.targetId;
    value.target = { $case: effect.targetKind, value: effect.targetId };
  } else if (effect.kind === "field-configuration") {
    value.origin = effect.origin === null ? null : toFieldTemplateConfig(effect.origin);
    value.review = effect.review === null ? null : toFieldTemplateConfig(effect.review);
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
  if (selected.$case === "value") {
    const target = required(
      decoded.target as { $case: "node" | "occurrence"; value: string } | null,
      "Value decision target",
    );
    delete decoded.target;
    decoded.targetKind = target.$case;
    decoded.targetId = target.value;
  } else if (selected.$case === "fieldConfiguration") {
    decoded.origin = decoded.origin === null ? null : fromFieldTemplateConfig(decoded.origin);
    decoded.review = decoded.review === null ? null : fromFieldTemplateConfig(decoded.review);
  }
  return { ...decoded, kind: decisionEffectKind(selected.$case) } as DecisionEffect;
}

export function toConflictIssue(issue: ConflictIssue): Record<string, unknown> {
  const value = toProtocolValue(issue) as Record<string, unknown>;
  delete value.kind;
  if (issue.kind === "field-config-conflict") {
    value.candidates = issue.candidates.map((candidate) => ({
      ...candidate,
      config: toFieldTemplateConfig(candidate.config),
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
      config: fromFieldTemplateConfig(candidate.config),
    }));
  } else if (selected.$case === "fieldInitializationConflict") {
    decoded.candidates = (decoded.candidates as readonly Record<string, unknown>[]).map((candidate) => ({
      ...candidate,
      values: (candidate.values as readonly unknown[]).map(fromFieldValueSeed),
    }));
  }
  return { ...decoded, kind: conflictIssueKind(selected.$case) } as ConflictIssue;
}

export function toFieldTemplateConfig(config: FieldTemplateConfig): Record<string, unknown> {
  const value = {
    visibility: config.visibility,
    staticDefault: config.staticDefault === null ? null : { values: config.staticDefault.map(toFieldValueSeed) },
    initializer:
      config.initializer === null
        ? null
        : {
            initializer:
              config.initializer.kind === "literal"
                ? { $case: "literal", value: { values: config.initializer.values.map(toFieldValueSeed) } }
                : { $case: "applicationNodeText", value: {} },
          },
  };
  return toProtocolMessage(FieldTemplateConfigSchema, value) as Record<string, unknown>;
}

export function fromFieldTemplateConfig(value: unknown): FieldTemplateConfig {
  const config = required(
    fromProtocolMessage(FieldTemplateConfigSchema, value) as Record<string, unknown> | null,
    "Field template config",
  );
  const initializer = config.initializer as {
    initializer: { $case: "literal" | "applicationNodeText"; value: unknown } | null;
  } | null;
  const selected = initializer === null ? null : required(initializer.initializer, "Field initializer");
  return {
    visibility: config.visibility,
    staticDefault:
      config.staticDefault === null
        ? null
        : (config.staticDefault as { values: readonly unknown[] }).values.map(fromFieldValueSeed),
    initializer:
      selected === null
        ? null
        : selected.$case === "literal"
          ? {
              kind: "literal",
              values: (selected.value as { values: readonly unknown[] }).values.map(fromFieldValueSeed),
            }
          : { kind: "application-node-text" },
  } as FieldTemplateConfig;
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
