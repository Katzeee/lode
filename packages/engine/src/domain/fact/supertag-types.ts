import type { NodeSeed } from "./node-create-types.js";
import type { FactActionId, SequenceAnchor } from "./types.js";

export type TemplateFieldVisibility = "normal" | "pinned";

export type SupertagAction =
  | Readonly<{
      kind: "supertag-application-add";
      hostNodeId: string;
      supertagId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "supertag-membership-remove";
      hostNodeId: string;
      supertagId: string;
    }>
  | Readonly<{ kind: "supertag-extension-add"; supertagId: string; baseSupertagId: string; anchor: SequenceAnchor }>
  | Readonly<{
      kind: "supertag-extension-remove";
      supertagId: string;
      baseSupertagId: string;
    }>
  | Readonly<{
      kind: "template-member-add";
      supertagId: string;
      templateNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "template-member-remove";
      supertagId: string;
      templateNodeId: string;
    }>
  | TemplateFieldAction
  | OptionalFieldContributionAction;

type TemplateFieldAction =
  | Readonly<{
      kind: "template-field-add";
      supertagId: string;
      fieldDefinition:
        | Readonly<{ kind: "new"; fieldDefinitionId: string; seed?: NodeSeed }>
        | Readonly<{ kind: "existing"; fieldDefinitionId: string }>;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "template-field-remove";
      supertagId: string;
      fieldDefinitionId: string;
    }>
  | Readonly<{
      kind: "template-field-restore";
      templateFieldId: FactActionId;
    }>
  | Readonly<{
      kind: "template-field-visibility-set";
      templateFieldId: FactActionId;
      visibility: TemplateFieldVisibility;
    }>
  | Readonly<{
      kind: "template-field-static-default-set";
      templateFieldId: FactActionId;
      value: string;
    }>;

type OptionalFieldContributionAction =
  | Readonly<{
      kind: "optional-field-contribution-add";
      supertagId: string;
      fieldDefinitionId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "optional-field-contribution-remove";
      supertagId: string;
      fieldDefinitionId: string;
    }>;
