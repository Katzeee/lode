import type { NodeSeed, SequenceAnchor, TemplateFieldVisibility } from "../fact/index.js";

export type CreateSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-create";
  supertagId: string;
  templateFieldNodeId: string;
  templateFieldOccurrenceId: string;
  fieldDefinitionId: string;
  definitionOccurrenceId: string;
  staticDefaultValueNodeId: string;
  staticDefaultValueOccurrenceId: string;
  anchor: SequenceAnchor;
  fieldDefinitionSeed?: NodeSeed;
}>;

export type AddExistingSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-add-existing";
  supertagId: string;
  templateFieldNodeId: string;
  templateFieldOccurrenceId: string;
  fieldDefinitionId: string;
  definitionOccurrenceId: string;
  staticDefaultValueNodeId: string;
  staticDefaultValueOccurrenceId: string;
  anchor: SequenceAnchor;
}>;

export type MakeSupertagTemplateFieldDiscoverableEdit = Readonly<{
  kind: "supertag-template-field-make-discoverable";
  supertagId: string;
  templateFieldNodeId: string;
  fieldDefinitionId: string;
}>;

export type RemoveSupertagTemplateFieldEdit = Readonly<{
  kind: "supertag-template-field-remove";
  supertagId: string;
  templateFieldNodeId: string;
}>;

export type SetSupertagTemplateFieldVisibilityEdit = Readonly<{
  kind: "supertag-template-field-visibility-set";
  supertagId: string;
  templateFieldNodeId: string;
  visibility: TemplateFieldVisibility;
}>;

export type SetSupertagTemplateFieldStaticDefaultEdit = Readonly<{
  kind: "supertag-template-field-static-default-set";
  supertagId: string;
  templateFieldNodeId: string;
  value: string;
}>;

export type AddSupertagOptionalFieldContributionEdit = Readonly<{
  kind: "supertag-optional-field-contribution-add";
  supertagId: string;
  metanodeId: string;
  fieldNurseryNodeId: string;
  fieldNurseryOccurrenceId: string;
  nurseryDefinitionOccurrenceId: string;
  nurseryValueNodeId: string;
  nurseryValueOccurrenceId: string;
  contributionNodeId: string;
  contributionOccurrenceId: string;
  fieldDefinitionId: string;
  definitionOccurrenceId: string;
  valueNodeId: string;
  valueOccurrenceId: string;
  anchor: SequenceAnchor;
}>;
