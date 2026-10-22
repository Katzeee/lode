import { enumValue, nonempty, ShapeValidationError, stringValue } from "../../decoding/index.js";
import {
  parseNodeSeed,
  parseSearchClause,
  parseSearchExpressionDraft,
  parseSequenceAnchor,
  requireFactActionId,
  STRING_WIRE,
  type FactActionId,
  type NodeSeed,
  type SearchClause,
  type SearchExpressionDraft,
  type SequenceAnchor,
} from "../fact/index.js";
import { editField, type EditField } from "./edit-definition.js";

export function nonemptyStringField(label: string): EditField<string> {
  return editField(label, STRING_WIRE, nonempty);
}

export function stringField(label: string): EditField<string> {
  return editField(label, STRING_WIRE, stringValue);
}

export function factActionIdField(label: string): EditField<FactActionId> {
  return editField(label, STRING_WIRE, requireFactActionId);
}

export function nullableFactActionIdField(label: string): EditField<FactActionId | null> {
  return editField(label, { kind: "string-value" }, (value, fieldLabel) =>
    value === null ? null : requireFactActionId(value, fieldLabel),
  );
}

export function enumField<const Values extends readonly string[]>(
  label: string,
  wireEnum: string,
  values: Values,
): EditField<Values[number]> {
  return editField(label, { kind: "enum", enum: wireEnum }, (value, fieldLabel) =>
    enumValue(value, values, fieldLabel),
  );
}

export function finiteNumberField(label: string): EditField<number> {
  return editField(label, { kind: "scalar", scalar: "double" }, (value, fieldLabel) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ShapeValidationError(`${fieldLabel} must be finite`);
    }
    return Object.is(value, -0) ? 0 : value;
  });
}

export function booleanField(label: string): EditField<boolean> {
  return editField(label, { kind: "scalar", scalar: "bool" }, (value, fieldLabel) => {
    if (typeof value !== "boolean") {
      throw new ShapeValidationError(`${fieldLabel} must be boolean`);
    }
    return value;
  });
}

export function calendarDateField(label: string): EditField<string> {
  return editField(label, STRING_WIRE, (value, fieldLabel) => {
    if (typeof value !== "string") {
      throw new ShapeValidationError(`${fieldLabel} must use YYYY-MM-DD`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match === null) {
      throw new ShapeValidationError(`${fieldLabel} must use YYYY-MM-DD`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new ShapeValidationError(`${fieldLabel} is not a calendar date`);
    }
    return value;
  });
}

export const sequenceAnchorField: EditField<SequenceAnchor> = editField(
  "Sequence anchor",
  { kind: "message", message: "SequenceAnchor" },
  (value) => parseSequenceAnchor(value),
);

export const nodeSeedField: EditField<NodeSeed> = editField(
  "Node seed",
  { kind: "message", message: "NodeSeed" },
  (value) => parseNodeSeed(value),
);

export const searchClauseField: EditField<SearchClause> = editField(
  "Search clause",
  { kind: "message", message: "SearchClause" },
  (value) => parseSearchClause(value),
);

export const searchExpressionDraftField: EditField<SearchExpressionDraft> = editField(
  "Search Expression draft",
  { kind: "message", message: "SearchExpressionDraft" },
  (value) => parseSearchExpressionDraft(value),
);
