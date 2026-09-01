import { defineAction, defineActionFamily, field } from "./action-definition.js";
import { fieldDefinitionIdentities, identity, relationKey, supertagIdentities } from "./action-contribution-helpers.js";
import type { IdentityContribution } from "./action-contribution-types.js";
import { factActionIdField, nonemptyStringField } from "./action-field-decoders.js";
import { parseFieldDefinitionConfiguration } from "./field-definition-config-shape.js";
import type { FieldDefinitionConfigurationValue } from "./field-definition-config-types.js";

export const fieldActionDefinitions = defineActionFamily({
  materialize: defineAction(
    "field-materialize",
    "proposable",
    "direct",
    {
      ownerNodeId: nonemptyStringField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      {
        kind: "field-materialization",
        ownerNodeId: action.ownerNodeId,
        fieldDefinitionId: action.fieldDefinitionId,
      },
      {
        kind: "causal-register-write",
        registerKey: relationKey("materialized-field", action.ownerNodeId, action.fieldDefinitionId),
      },
      ...fieldDefinitionIdentities(action.fieldDefinitionId, "require"),
    ],
  ),
  removeValue: defineAction(
    "field-value-remove",
    "proposable",
    "direct",
    { valuePlacementId: nonemptyStringField },
    (action) => [identity({ kind: "occurrence", occurrenceId: action.valuePlacementId }, "relate", "require")],
  ),
  clearMaterialized: defineAction(
    "materialized-field-clear",
    "proposable",
    "direct",
    {
      ownerNodeId: nonemptyStringField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.ownerNodeId }, "relate", "require", "contribution-owner"),
      ...fieldDefinitionIdentities(action.fieldDefinitionId, "require"),
      {
        kind: "causal-register-write",
        registerKey: relationKey("materialized-field", action.ownerNodeId, action.fieldDefinitionId),
      },
    ],
  ),
});

const fieldConfigurationField = field<FieldDefinitionConfigurationValue>((value) =>
  parseFieldDefinitionConfiguration(value),
);

export const fieldDefinitionActionDefinitions = defineActionFamily({
  configure: defineAction(
    "field-configuration-set",
    "proposable",
    "internal",
    {
      fieldDefinitionId: nonemptyStringField,
      configuration: fieldConfigurationField,
    },
    (action) => {
      return [
        ...fieldDefinitionIdentities(action.fieldDefinitionId, "require", true),
        ...configurationIdentities(action.configuration),
      ];
    },
  ),
  makeDiscoverable: defineAction(
    "field-definition-make-discoverable",
    "proposable",
    "internal",
    {
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "field-definition", nodeId: action.fieldDefinitionId }, "relate", "contribution-owner"),
      identity({ kind: "node", nodeId: action.fieldDefinitionId }, "require"),
      {
        kind: "causal-register-write",
        registerKey: relationKey("field-discoverability", action.fieldDefinitionId),
      },
    ],
  ),
  returnToTemplateField: defineAction(
    "field-definition-return-to-template-field",
    "proposable",
    "internal",
    {
      fieldDefinitionId: nonemptyStringField,
      templateFieldId: factActionIdField,
    },
    (action) => [
      identity({ kind: "field-definition", nodeId: action.fieldDefinitionId }, "relate", "contribution-owner"),
      identity({ kind: "node", nodeId: action.fieldDefinitionId }, "require"),
      identity({ kind: "fact-action", factActionId: action.templateFieldId }, "relate", "require"),
      {
        kind: "causal-register-write",
        registerKey: relationKey("field-discoverability", action.fieldDefinitionId),
      },
    ],
  ),
});

function configurationIdentities(configuration: FieldDefinitionConfigurationValue): readonly IdentityContribution[] {
  if (configuration.kind === "datatype") {
    return [
      identity({ kind: "node", nodeId: configuration.datatypeNodeId }, "relate", "require"),
      ...(configuration.optionsSupertagId === undefined
        ? []
        : supertagIdentities(configuration.optionsSupertagId, false)),
    ];
  }
  if (configuration.kind === "cardinality") {
    return [identity({ kind: "node", nodeId: configuration.cardinalityNodeId }, "relate", "require")];
  }
  if (configuration.kind === "optionality") {
    return [identity({ kind: "node", nodeId: configuration.optionalityNodeId }, "relate", "require")];
  }
  return fieldDefinitionIdentities(configuration.expression.sourceFieldDefinitionId, "require");
}
