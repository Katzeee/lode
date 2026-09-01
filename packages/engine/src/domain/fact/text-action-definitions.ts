import { assertJsonValue, exact, object, ShapeValidationError } from "../../decoding/index.js";
import { atomProducer } from "./action-contribution-helpers.js";
import { defineAction, defineActionFamily, field, optionalField } from "./action-definition.js";
import { arrayField, nonemptyStringField, sequenceAnchorField, stringField } from "./action-field-decoders.js";
import type { JsonValue, PreviousValue, SequenceAnchor, TextAtomId } from "./fact-value-types.js";
import { parseJsonRecord, parseTextAtomId } from "./serialized-shape.js";

const textAtomIdsField = arrayField<TextAtomId>((value) => parseTextAtomId(value), { kind: "string-list" });
const attributesField = field<Readonly<Record<string, JsonValue>>>((value) => parseJsonRecord(value), {
  kind: "json-map",
});
const previousValueField = field<PreviousValue>(
  (value, label) => {
    const previous = object(value, label);
    exact(previous, previous.kind === "set" ? ["kind", "value"] : ["kind"], label);
    if (previous.kind === "unset") {
      return { kind: "unset" };
    }
    if (previous.kind === "set") {
      assertJsonValue(previous.value, label);
      return { kind: "set", value: previous.value as JsonValue };
    }
    throw new ShapeValidationError(`Unknown ${label} kind`);
  },
  { kind: "message", message: "PreviousValue" },
);

const textSequenceAnchorField = field<SequenceAnchor>(
  (value, label) => {
    const anchor = sequenceAnchorField.parse(value, label);
    if (anchor.after !== null) {
      parseTextAtomId(anchor.after);
    }
    if (anchor.before !== null) {
      parseTextAtomId(anchor.before);
    }
    return anchor;
  },
  { kind: "message", message: "SequenceAnchor" },
);

export const textActionDefinitions = defineActionFamily({
  splice: defineAction(
    "rich-text-splice",
    "proposable",
    "direct",
    {
      nodeId: nonemptyStringField,
      deleteAtomIds: textAtomIdsField,
      anchor: textSequenceAnchorField,
      insert: stringField,
      attributes: optionalField(attributesField),
    },
    (action) => [
      {
        kind: "text-operation",
        operation: "splice",
        nodeId: action.nodeId,
        referencedActionIds: action.deleteAtomIds.map(atomProducer),
        anchor: action.anchor,
      },
    ],
  ),
  mark: defineAction(
    "rich-text-mark",
    "proposable",
    "direct",
    {
      nodeId: nonemptyStringField,
      atomIds: textAtomIdsField,
      key: nonemptyStringField,
      value: previousValueField,
    },
    (action) => [
      {
        kind: "text-operation",
        operation: "mark",
        nodeId: action.nodeId,
        referencedActionIds: action.atomIds.map(atomProducer),
      },
    ],
  ),
});
