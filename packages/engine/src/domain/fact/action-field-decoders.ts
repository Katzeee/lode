import { array, enumValue, nonempty, nullableString, object, stringValue } from "../../decoding/index.js";
import { field } from "./action-definition.js";
import { requireFactActionId } from "./identities.js";
import { parseSequenceAnchor } from "./serialized-shape.js";
import type { FactActionId, SequenceAnchor } from "./fact-value-types.js";

export const nonemptyStringField = field((value, label) => nonempty(value, label));
export const stringField = field((value, label) => stringValue(value, label));
export const sequenceAnchorField = field<SequenceAnchor>((value) => parseSequenceAnchor(value));
export const factActionIdField = field<FactActionId>((value, label) => requireFactActionId(value, label));
export const nullableFactActionIdField = field<FactActionId | null>((value, label) =>
  value === null ? null : requireFactActionId(value, label),
);

export function enumField<const Values extends readonly string[]>(values: Values) {
  return field<Values[number]>((value, label) => enumValue(value, values, label));
}

export function arrayField<Output>(parseItem: (value: unknown, label: string) => Output) {
  return field<readonly Output[]>((value, label) => array(value, label, (item) => parseItem(item, label)));
}

export function nullableStringField() {
  return field<string | null>((value, label) => nullableString(value, label));
}

export function recordField<Output>(parse: (record: Record<string, unknown>, label: string) => Output) {
  return field<Output>((value, label) => parse(object(value, label), label));
}
