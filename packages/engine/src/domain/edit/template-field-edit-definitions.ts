import { defineEdit, defineEditFamily, optionalEditField } from "./edit-definition.js";
import {
  enumField,
  factActionIdField,
  nodeSeedField,
  nonemptyStringField,
  sequenceAnchorField,
  stringField,
} from "./edit-field-decoders.js";

const supertagId = nonemptyStringField("Supertag Definition");
const templateFieldId = factActionIdField("Template Field identity");
const optionalFieldDefinitionId = nonemptyStringField("Optional Field Definition");

export const templateFieldEditDefinitions = defineEditFamily({
  create: defineEdit(
    "supertag-template-field-create",
    {
      supertagId,
      fieldDefinitionId: nonemptyStringField("Template Field Definition identity"),
      anchor: sequenceAnchorField,
      fieldDefinitionSeed: optionalEditField(nodeSeedField),
    },
    {
      plan: (edit) => [
        {
          kind: "template-field-add",
          supertagId: edit.supertagId,
          fieldDefinition: {
            kind: "new",
            fieldDefinitionId: edit.fieldDefinitionId,
            ...(edit.fieldDefinitionSeed === undefined ? {} : { seed: edit.fieldDefinitionSeed }),
          },
          anchor: edit.anchor,
        },
      ],
    },
  ),
  addExisting: defineEdit(
    "supertag-template-field-add-existing",
    {
      supertagId,
      fieldDefinitionId: nonemptyStringField("Existing Field Definition"),
      anchor: sequenceAnchorField,
    },
    {
      plan: (edit) => [
        {
          kind: "template-field-add",
          supertagId: edit.supertagId,
          fieldDefinition: { kind: "existing", fieldDefinitionId: edit.fieldDefinitionId },
          anchor: edit.anchor,
        },
      ],
    },
  ),
  makeDiscoverable: defineEdit("supertag-template-field-make-discoverable", { supertagId, templateFieldId }),
  remove: defineEdit("supertag-template-field-remove", { supertagId, templateFieldId }),
  setVisibility: defineEdit("supertag-template-field-visibility-set", {
    supertagId,
    templateFieldId,
    visibility: enumField("Template Field visibility", "TemplateFieldVisibility", ["normal", "pinned"] as const),
  }),
  setStaticDefault: defineEdit("supertag-template-field-static-default-set", {
    supertagId,
    templateFieldId,
    value: stringField("Template Field Static Default"),
  }),
  addOptionalFieldContribution: defineEdit(
    "supertag-optional-field-contribution-add",
    {
      supertagId,
      fieldDefinitionId: optionalFieldDefinitionId,
      anchor: sequenceAnchorField,
    },
    {
      plan: (edit) => [
        {
          kind: "optional-field-contribution-add",
          supertagId: edit.supertagId,
          fieldDefinitionId: edit.fieldDefinitionId,
          anchor: edit.anchor,
        },
      ],
    },
  ),
  removeOptionalFieldContribution: defineEdit(
    "supertag-optional-field-contribution-remove",
    {
      supertagId,
      fieldDefinitionId: optionalFieldDefinitionId,
    },
    {
      plan: (edit) => [
        {
          kind: "optional-field-contribution-remove",
          supertagId: edit.supertagId,
          fieldDefinitionId: edit.fieldDefinitionId,
        },
      ],
    },
  ),
});
