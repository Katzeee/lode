import { ShapeValidationError } from "../../decoding/index.js";
import { defineEdit, defineEditFamily, optionalEditField } from "./edit-definition.js";
import { booleanField, calendarDateField, finiteNumberField, nonemptyStringField } from "./edit-field-decoders.js";

const ownerNodeId = nonemptyStringField("Field owner Node identity");
const fieldDefinitionId = nonemptyStringField("Field Definition identity");

export const typedFieldValueEditDefinitions = defineEditFamily({
  setNumber: defineEdit("field-number-value-set", {
    ownerNodeId,
    fieldDefinitionId,
    valueNodeId: nonemptyStringField("Number value Node identity"),
    valueOccurrenceId: nonemptyStringField("Number value Occurrence identity"),
    value: finiteNumberField("Number Field value"),
  }),
  setDate: defineEdit("field-date-value-set", {
    ownerNodeId,
    fieldDefinitionId,
    valueNodeId: nonemptyStringField("Date value Node identity"),
    valueOccurrenceId: nonemptyStringField("Date value Occurrence identity"),
    value: calendarDateField("Date Field value"),
  }),
  setCheckbox: defineEdit("field-checkbox-value-set", {
    ownerNodeId,
    fieldDefinitionId,
    valueOccurrenceId: nonemptyStringField("Checkbox value Occurrence identity"),
    value: booleanField("Checkbox Field value"),
  }),
  setOptionsFromSupertag: defineEdit("field-options-from-supertag-value-set", {
    ownerNodeId,
    fieldDefinitionId,
    valueOccurrenceId: nonemptyStringField("Options value Occurrence identity"),
    targetNodeId: nonemptyStringField("Options target Node identity"),
  }),
  clear: defineEdit(
    "typed-field-value-clear",
    {
      ownerNodeId,
      fieldDefinitionId,
      emptyValueNodeId: optionalEditField(nonemptyStringField("Empty value Node identity")),
      emptyValueOccurrenceId: optionalEditField(nonemptyStringField("Empty value Occurrence identity")),
    },
    {
      refine: (edit) => {
        if ((edit.emptyValueNodeId === undefined) !== (edit.emptyValueOccurrenceId === undefined)) {
          throw new ShapeValidationError("Typed Field clear placeholder identities must be supplied together");
        }
        return edit;
      },
    },
  ),
});
