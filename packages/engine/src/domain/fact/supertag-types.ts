import type { SequenceAnchor } from "./types.js";

export type TemplateFieldVisibility = "normal" | "pinned";

export type SupertagMutation =
  | Readonly<{
      kind: "supertag-apply";
      hostNodeId: string;
      supertagId: string;
      applicationNodeId: string;
      applicationOccurrenceId: string;
      relationDefinitionOccurrenceId: string;
      definitionOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-remove";
      hostNodeId: string;
      supertagId: string;
      applicationNodeId: string;
      applicationOccurrenceId: string;
      relationDefinitionOccurrenceId: string;
      definitionOccurrenceId: string;
      detachedValueNodeId: string;
      detachedValueOccurrenceId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{ kind: "supertag-extension-add"; supertagId: string; baseSupertagId: string; anchor: SequenceAnchor }>
  | Readonly<{
      kind: "supertag-extension-remove";
      supertagId: string;
      baseSupertagId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-template-node-add";
      supertagId: string;
      templateNodeId: string;
      templateOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-template-node-remove";
      supertagId: string;
      templateNodeId: string;
      templateOccurrenceId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | SupertagTemplateFieldMutation
  | SupertagOptionalFieldContributionMutation;

export type SupertagTemplateFieldMutation =
  | Readonly<{
      kind: "supertag-template-field-attach";
      supertagId: string;
      templateFieldNodeId: string;
      templateFieldOccurrenceId: string;
      fieldDefinitionId: string;
      definitionOccurrenceId: string;
      staticDefaultValueNodeId: string;
      staticDefaultValueOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-template-field-existing-attach";
      supertagId: string;
      templateFieldNodeId: string;
      templateFieldOccurrenceId: string;
      fieldDefinitionId: string;
      definitionOccurrenceId: string;
      staticDefaultValueNodeId: string;
      staticDefaultValueOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-template-field-detach";
      supertagId: string;
      templateFieldNodeId: string;
      templateFieldOccurrenceId: string;
      fieldDefinitionId: string;
      definitionOccurrenceId: string;
      staticDefaultValueNodeId: string;
      staticDefaultValueOccurrenceId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-template-field-discoverability-set";
      supertagId: string;
      templateFieldNodeId: string;
      fieldDefinitionId: string;
      discoverable: boolean;
      previousDiscoverable?: boolean;
    }>
  | Readonly<{
      kind: "supertag-template-field-visibility-configure";
      supertagId: string;
      templateFieldNodeId: string;
      fieldDefinitionId: string;
      visibility: TemplateFieldVisibility;
      previousVisibility?: TemplateFieldVisibility;
      observedVisibilityFactIds?: readonly string[];
    }>;

type OptionalFieldContributionBase = Readonly<{
  supertagId: string;
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
}>;

export type SupertagOptionalFieldContributionMutation =
  | (OptionalFieldContributionBase &
      Readonly<{ kind: "supertag-optional-field-contribution-attach"; anchor: SequenceAnchor }>)
  | (OptionalFieldContributionBase &
      Readonly<{ kind: "supertag-optional-field-contribution-detach"; previousAnchor?: SequenceAnchor }>);
