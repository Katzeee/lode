import { nonempty, ShapeValidationError } from "../../decoding/index.js";
import { FIELD_DATATYPE_NODE_IDS, parseAuthoredAction, type FieldInitializationExpression } from "../fact/index.js";
import { defineEdit, defineEditFamily, editField, optionalEditField } from "./edit-definition.js";
import { nonemptyStringField } from "./edit-field-decoders.js";

const fieldDefinitionId = nonemptyStringField("Field Definition identity");

// The expression evidence is validated as the field-configuration-set Fact Action shape, so the
// edit vocabulary cannot drift from what the Fact catalog accepts.
const initializationExpressionField = editField<FieldInitializationExpression>(
  "Field Initialization Expression",
  { kind: "message", message: "FieldInitializationExpression" },
  (value) => {
    const action = parseAuthoredAction({
      kind: "field-configuration-set",
      fieldDefinitionId: "input-field-definition",
      configuration: { kind: "initialization-expression", expression: value },
    });
    if (action.kind !== "field-configuration-set" || action.configuration.kind !== "initialization-expression") {
      throw new ShapeValidationError("Field Initialization Expression is invalid");
    }
    return action.configuration.expression;
  },
);

export const fieldDefinitionConfigurationEditDefinitions = defineEditFamily({
  configureDatatype: defineEdit(
    "field-datatype-configure",
    {
      fieldDefinitionId,
      datatypeNodeId: nonemptyStringField("Field Datatype endpoint Node identity"),
      optionsSupertagId: optionalEditField(nonemptyStringField("Options source Supertag identity")),
    },
    {
      refine: (edit) => {
        if (edit.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag) {
          nonempty(edit.optionsSupertagId, "Options source Supertag identity");
          return edit;
        }
        if (edit.optionsSupertagId !== undefined) {
          throw new ShapeValidationError("Only Options from Supertag accepts a source Supertag");
        }
        return edit;
      },
      plan: (edit) => [
        {
          kind: "field-configuration-set",
          fieldDefinitionId: edit.fieldDefinitionId,
          configuration: {
            kind: "datatype",
            datatypeNodeId: edit.datatypeNodeId,
            ...(edit.optionsSupertagId === undefined ? {} : { optionsSupertagId: edit.optionsSupertagId }),
          },
        },
      ],
    },
  ),
  configureCardinality: defineEdit(
    "field-cardinality-configure",
    {
      fieldDefinitionId,
      cardinalityNodeId: nonemptyStringField("Field Cardinality endpoint Node identity"),
    },
    {
      plan: (edit) => [
        {
          kind: "field-configuration-set",
          fieldDefinitionId: edit.fieldDefinitionId,
          configuration: { kind: "cardinality", cardinalityNodeId: edit.cardinalityNodeId },
        },
      ],
    },
  ),
  configureOptionality: defineEdit(
    "field-optionality-configure",
    {
      fieldDefinitionId,
      optionalityNodeId: nonemptyStringField("Field Optionality endpoint Node identity"),
    },
    {
      plan: (edit) => [
        {
          kind: "field-configuration-set",
          fieldDefinitionId: edit.fieldDefinitionId,
          configuration: { kind: "optionality", optionalityNodeId: edit.optionalityNodeId },
        },
      ],
    },
  ),
  configureInitializationExpression: defineEdit(
    "field-initialization-expression-configure",
    {
      fieldDefinitionId,
      expression: initializationExpressionField,
    },
    {
      plan: (edit) => [
        {
          kind: "field-configuration-set",
          fieldDefinitionId: edit.fieldDefinitionId,
          configuration: { kind: "initialization-expression", expression: edit.expression },
        },
      ],
    },
  ),
});
