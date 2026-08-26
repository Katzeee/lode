import {
  anchorIdentities,
  fieldDefinitionIdentities,
  identity,
  relationKey,
  supertagIdentities,
} from "./action-semantics/contribution-helpers.js";
import { SELF_FACT_ACTION } from "./action-semantics/types.js";
import { defineAction, defineActionFamily } from "./action-definition.js";
import {
  enumField,
  factActionIdField,
  nonemptyStringField,
  sequenceAnchorField,
  stringField,
} from "./action-field-decoders.js";
import { templateFieldDefinitionField } from "./template-field-definition-shape.js";

export const supertagActionDefinitions = defineActionFamily({
  addApplication: defineAction(
    "supertag-application-add",
    "proposable",
    {
      hostNodeId: nonemptyStringField,
      supertagId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.hostNodeId }, "relate", "require", "contribution-owner"),
      ...supertagIdentities(action.supertagId, false),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "supertag-application",
        operation: "add",
        key: relationKey(action.hostNodeId, action.supertagId),
        entryId: SELF_FACT_ACTION,
        initialRegisters: { position: action.anchor },
      },
    ],
  ),
  removeMembership: defineAction(
    "supertag-membership-remove",
    "proposable",
    {
      hostNodeId: nonemptyStringField,
      supertagId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.hostNodeId }, "relate", "require", "contribution-owner"),
      ...supertagIdentities(action.supertagId, false),
      {
        kind: "causal-collection",
        collection: "supertag-application",
        operation: "remove-observed",
        key: relationKey(action.hostNodeId, action.supertagId),
      },
    ],
  ),
  addExtension: defineAction(
    "supertag-extension-add",
    "proposable",
    {
      supertagId: nonemptyStringField,
      baseSupertagId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, true, true),
      ...supertagIdentities(action.baseSupertagId, true),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "supertag-extension",
        operation: "add",
        key: relationKey(action.supertagId, action.baseSupertagId),
        entryId: SELF_FACT_ACTION,
        initialRegisters: { position: action.anchor },
      },
    ],
  ),
  removeExtension: defineAction(
    "supertag-extension-remove",
    "proposable",
    {
      supertagId: nonemptyStringField,
      baseSupertagId: nonemptyStringField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, true, true),
      ...supertagIdentities(action.baseSupertagId, true),
      {
        kind: "causal-collection",
        collection: "supertag-extension",
        operation: "remove-observed",
        key: relationKey(action.supertagId, action.baseSupertagId),
      },
    ],
  ),
  addTemplateMember: defineAction(
    "template-member-add",
    "proposable",
    {
      supertagId: nonemptyStringField,
      templateNodeId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, false, true),
      identity({ kind: "node", nodeId: action.templateNodeId }, "relate", "require"),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "template-member",
        operation: "add",
        key: relationKey(action.supertagId, action.templateNodeId),
        entryId: SELF_FACT_ACTION,
        initialRegisters: { position: action.anchor },
      },
    ],
  ),
  removeTemplateMember: defineAction(
    "template-member-remove",
    "proposable",
    {
      supertagId: nonemptyStringField,
      templateNodeId: nonemptyStringField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, false, true),
      identity({ kind: "node", nodeId: action.templateNodeId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "template-member",
        operation: "remove-observed",
        key: relationKey(action.supertagId, action.templateNodeId),
      },
    ],
  ),
  addTemplateField: defineAction(
    "template-field-add",
    "proposable",
    {
      supertagId: nonemptyStringField,
      fieldDefinition: templateFieldDefinitionField,
      anchor: sequenceAnchorField,
    },
    (action) => {
      const definition = action.fieldDefinition;
      return [
        ...supertagIdentities(action.supertagId, false, true),
        ...fieldDefinitionIdentities(
          definition.fieldDefinitionId,
          definition.kind === "new" ? "declare" : "require",
          definition.kind === "new",
        ),
        ...anchorIdentities(action.anchor),
        {
          kind: "causal-collection",
          collection: "template-field",
          operation: "add",
          key: relationKey(action.supertagId, definition.fieldDefinitionId),
          entryId: SELF_FACT_ACTION,
          initialRegisters: { position: action.anchor },
        },
      ];
    },
  ),
  removeTemplateField: defineAction(
    "template-field-remove",
    "proposable",
    {
      supertagId: nonemptyStringField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, false, true),
      ...fieldDefinitionIdentities(action.fieldDefinitionId, "require"),
      {
        kind: "causal-collection",
        collection: "template-field",
        operation: "remove-observed",
        key: relationKey(action.supertagId, action.fieldDefinitionId),
      },
    ],
  ),
  restoreTemplateField: defineAction(
    "template-field-restore",
    "proposable",
    {
      templateFieldId: factActionIdField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.templateFieldId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "template-field",
        operation: "restore",
        entryId: action.templateFieldId,
      },
    ],
  ),
  setTemplateFieldVisibility: defineAction(
    "template-field-visibility-set",
    "proposable",
    {
      templateFieldId: factActionIdField,
      visibility: enumField(["normal", "pinned"] as const),
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.templateFieldId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "template-field",
        operation: "register",
        entryId: action.templateFieldId,
        register: "visibility",
        value: action.visibility,
      },
    ],
  ),
  setTemplateFieldStaticDefault: defineAction(
    "template-field-static-default-set",
    "proposable",
    {
      templateFieldId: factActionIdField,
      value: stringField,
    },
    (action) => [
      identity({ kind: "fact-action", factActionId: action.templateFieldId }, "relate", "require"),
      {
        kind: "causal-collection",
        collection: "template-field",
        operation: "register",
        entryId: action.templateFieldId,
        register: "static-default",
        value: action.value,
      },
    ],
  ),
  addOptionalFieldContribution: defineAction(
    "optional-field-contribution-add",
    "proposable",
    {
      supertagId: nonemptyStringField,
      fieldDefinitionId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, false, true),
      ...fieldDefinitionIdentities(action.fieldDefinitionId, "require"),
      ...anchorIdentities(action.anchor),
      {
        kind: "causal-collection",
        collection: "optional-field",
        operation: "add",
        key: relationKey(action.supertagId, action.fieldDefinitionId),
        entryId: SELF_FACT_ACTION,
        initialRegisters: { position: action.anchor },
      },
    ],
  ),
  removeOptionalFieldContribution: defineAction(
    "optional-field-contribution-remove",
    "proposable",
    {
      supertagId: nonemptyStringField,
      fieldDefinitionId: nonemptyStringField,
    },
    (action) => [
      ...supertagIdentities(action.supertagId, false, true),
      ...fieldDefinitionIdentities(action.fieldDefinitionId, "require"),
      {
        kind: "causal-collection",
        collection: "optional-field",
        operation: "remove-observed",
        key: relationKey(action.supertagId, action.fieldDefinitionId),
      },
    ],
  ),
});
