import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";
import type { EditMutation } from "./types.js";

export function parseTypedFieldValueEdit(edit: Record<string, unknown>): EditMutation {
  const commonKeys = ["kind", "ownerNodeId", "fieldDefinitionId", "fieldNodeId", "fieldOccurrenceId"] as const;
  const common = {
    ownerNodeId: nonemptyInputString(edit.ownerNodeId, "Field owner Node identity"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Field Definition identity"),
    fieldNodeId: nonemptyInputString(edit.fieldNodeId, "Field Node identity"),
    fieldOccurrenceId: nonemptyInputString(edit.fieldOccurrenceId, "Field Occurrence identity"),
  };
  if (edit.kind === "field-number-value-set") {
    exactInputKeys(edit, [...commonKeys, "valueNodeId", "valueOccurrenceId", "value"]);
    if (typeof edit.value !== "number" || !Number.isFinite(edit.value)) {
      throw new Error("Number Field value must be finite");
    }
    return {
      kind: edit.kind,
      ...common,
      valueNodeId: nonemptyInputString(edit.valueNodeId, "Number value Node identity"),
      valueOccurrenceId: nonemptyInputString(edit.valueOccurrenceId, "Number value Occurrence identity"),
      value: Object.is(edit.value, -0) ? 0 : edit.value,
    };
  }
  if (edit.kind === "field-date-value-set") {
    exactInputKeys(edit, [...commonKeys, "valueNodeId", "valueOccurrenceId", "value"]);
    return {
      kind: edit.kind,
      ...common,
      valueNodeId: nonemptyInputString(edit.valueNodeId, "Date value Node identity"),
      valueOccurrenceId: nonemptyInputString(edit.valueOccurrenceId, "Date value Occurrence identity"),
      value: normalizedCalendarDate(edit.value),
    };
  }
  if (edit.kind === "field-checkbox-value-set") {
    exactInputKeys(edit, [...commonKeys, "valueOccurrenceId", "value"]);
    if (typeof edit.value !== "boolean") {
      throw new Error("Checkbox Field value must be boolean");
    }
    return {
      kind: edit.kind,
      ...common,
      valueOccurrenceId: nonemptyInputString(edit.valueOccurrenceId, "Checkbox value Occurrence identity"),
      value: edit.value,
    };
  }
  if (edit.kind === "field-options-from-supertag-value-set") {
    exactInputKeys(edit, [...commonKeys, "valueOccurrenceId", "targetNodeId"]);
    return {
      kind: edit.kind,
      ...common,
      valueOccurrenceId: nonemptyInputString(edit.valueOccurrenceId, "Options value Occurrence identity"),
      targetNodeId: nonemptyInputString(edit.targetNodeId, "Options target Node identity"),
    };
  }
  exactInputKeys(edit, [...commonKeys, "emptyValueNodeId", "emptyValueOccurrenceId"]);
  const hasNode = edit.emptyValueNodeId !== undefined;
  const hasOccurrence = edit.emptyValueOccurrenceId !== undefined;
  if (hasNode !== hasOccurrence) {
    throw new Error("Typed Field clear placeholder identities must be supplied together");
  }
  return {
    kind: "typed-field-value-clear",
    ...common,
    ...(hasNode
      ? {
          emptyValueNodeId: nonemptyInputString(edit.emptyValueNodeId, "Empty value Node identity"),
          emptyValueOccurrenceId: nonemptyInputString(edit.emptyValueOccurrenceId, "Empty value Occurrence identity"),
        }
      : {}),
  };
}

export function normalizedCalendarDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Date Field value must use YYYY-MM-DD");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error("Date Field value must use YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Date Field value is not a calendar date");
  }
  return value;
}
