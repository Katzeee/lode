import { array, exact, nonempty, object } from "../../decoding/index.js";
import type { TypedFieldValue } from "./projection-types.js";

export function parseTypedFieldValue(value: unknown): TypedFieldValue {
  const item = object(value, "Typed Field Value");
  exact(
    item,
    [
      "ownerNodeId",
      "fieldDefinitionId",
      "fieldNodeId",
      "fieldOccurrenceId",
      "datatypeNodeId",
      "valueOccurrenceIds",
      "state",
      "value",
    ],
    "Typed Field Value",
  );
  if (item.state !== "empty" && item.state !== "invalid" && item.state !== "value") {
    throw new Error("Typed Field Value state is invalid");
  }
  const base = {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    datatypeNodeId: identity(item.datatypeNodeId),
    valueOccurrenceIds: array(item.valueOccurrenceIds, "Value Occurrence identities", identity),
  };
  if (item.state !== "value") {
    if (item.value !== null) {
      throw new Error("Empty or invalid Typed Field Value must not contain a value");
    }
    return { ...base, state: item.state, value: null };
  }
  const semantic = object(item.value, "Typed Field semantic value");
  const common = {
    valueNodeId: identity(semantic.valueNodeId),
    valueOccurrenceId: identity(semantic.valueOccurrenceId),
  };
  if (semantic.kind === "number") {
    exact(semantic, ["kind", "valueNodeId", "valueOccurrenceId", "value"], "Number Field value");
    if (typeof semantic.value !== "number" || !Number.isFinite(semantic.value)) {
      throw new Error("Number Field value is invalid");
    }
    return { ...base, state: "value", value: { kind: "number", ...common, value: semantic.value } };
  }
  if (semantic.kind === "date") {
    exact(semantic, ["kind", "valueNodeId", "valueOccurrenceId", "value"], "Date Field value");
    return { ...base, state: "value", value: { kind: "date", ...common, value: identity(semantic.value) } };
  }
  if (semantic.kind === "checkbox") {
    exact(semantic, ["kind", "valueNodeId", "valueOccurrenceId", "value"], "Checkbox Field value");
    if (typeof semantic.value !== "boolean") {
      throw new Error("Checkbox Field value is invalid");
    }
    return { ...base, state: "value", value: { kind: "checkbox", ...common, value: semantic.value } };
  }
  if (semantic.kind === "options-from-supertag") {
    exact(semantic, ["kind", "valueNodeId", "valueOccurrenceId", "targetNodeId"], "Options from Supertag Field value");
    return {
      ...base,
      state: "value",
      value: { kind: "options-from-supertag", ...common, targetNodeId: identity(semantic.targetNodeId) },
    };
  }
  throw new Error("Typed Field semantic value kind is invalid");
}

function identity(value: unknown): string {
  return nonempty(value, "Identity");
}
