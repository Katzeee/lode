import type { FactActionId, NodeSeed, SequenceAnchor, TemplateFieldVisibility } from "../fact/index.js";

export type CreateSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-create";
  supertagId: string;
  fieldDefinitionId: string;
  anchor: SequenceAnchor;
  fieldDefinitionSeed?: NodeSeed;
}>;

export type AddExistingSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-add-existing";
  supertagId: string;
  fieldDefinitionId: string;
  anchor: SequenceAnchor;
}>;

export type MakeSupertagTemplateFieldDiscoverableEdit = Readonly<{
  kind: "supertag-template-field-make-discoverable";
  supertagId: string;
  templateFieldId: FactActionId;
}>;

export type RemoveSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-remove";
  supertagId: string;
  templateFieldId: FactActionId;
}>;

export type SetSupertagTemplateFieldVisibilityEdit = Readonly<{
  kind: "supertag-template-field-visibility-set";
  supertagId: string;
  templateFieldId: FactActionId;
  visibility: TemplateFieldVisibility;
}>;

export type SetSupertagTemplateFieldStaticDefaultEdit = Readonly<{
  kind: "supertag-template-field-static-default-set";
  supertagId: string;
  templateFieldId: FactActionId;
  value: string;
}>;

export type AddSupertagOptionalFieldContributionEdit = Readonly<{
  kind: "supertag-optional-field-contribution-add";
  supertagId: string;
  fieldDefinitionId: string;
  anchor: SequenceAnchor;
}>;

export type RemoveSupertagOptionalFieldContributionEdit = Readonly<{
  kind: "supertag-optional-field-contribution-remove";
  supertagId: string;
  fieldDefinitionId: string;
}>;
