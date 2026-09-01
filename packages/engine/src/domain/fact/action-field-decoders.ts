import { array, enumValue, nonempty, stringValue } from "../../decoding/index.js";
import { field } from "./action-definition.js";
import { requireFactActionId } from "./identities.js";
import { parseSequenceAnchor } from "./serialized-shape.js";
import { STRING_WIRE, type WireType } from "./wire-type.js";
import type { FactActionId, SequenceAnchor } from "./fact-value-types.js";

export const nonemptyStringField = field((value, label) => nonempty(value, label), STRING_WIRE);
export const stringField = field((value, label) => stringValue(value, label), STRING_WIRE);
export const sequenceAnchorField = field<SequenceAnchor>((value) => parseSequenceAnchor(value), {
  kind: "message",
  message: "SequenceAnchor",
});
export const factActionIdField = field<FactActionId>((value, label) => requireFactActionId(value, label), STRING_WIRE);
export const nullableFactActionIdField = field<FactActionId | null>(
  (value, label) => (value === null ? null : requireFactActionId(value, label)),
  { kind: "string-value" },
);

export function enumField<const Values extends readonly string[]>(values: Values, wire?: WireType) {
  return field<Values[number]>((value, label) => enumValue(value, values, label), wire);
}

export function arrayField<Output>(parseItem: (value: unknown, label: string) => Output, wire?: WireType) {
  return field<readonly Output[]>((value, label) => array(value, label, (item) => parseItem(item, label)), wire);
}
