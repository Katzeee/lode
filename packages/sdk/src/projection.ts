import type {
  MaterializedField as ProtocolMaterializedField,
  ProjectedNode as ProtocolProjectedNode,
  ProjectedOccurrence as ProtocolProjectedOccurrence,
  TemplateNodeInstance as ProtocolTemplateNodeInstance,
  TextAtom as ProtocolTextAtom,
  ProjectedInlineReference as ProtocolProjectedInlineReference,
  SharedDefaultViewDefinition as ProtocolSharedDefaultViewDefinition,
  FieldDefinitionConfiguration as ProtocolFieldDefinitionConfiguration,
  TemplateField as ProtocolTemplateField,
  TemplateFieldVisibilityCandidate as ProtocolTemplateFieldVisibilityCandidate,
  TemplateFieldStaticDefaultCandidate as ProtocolTemplateFieldStaticDefaultCandidate,
  OptionalFieldContribution as ProtocolOptionalFieldContribution,
} from "@lode/protocol/proto";
import type {
  IntrinsicNodeType,
  ProjectionIdentity,
  ProjectionPerspective,
  TextAtomId,
  ViewType,
  FieldInitializationExpression,
  TemplateFieldVisibility,
  SearchExpressionSpec,
  ViewOptionsSpec,
} from "./model.js";
import type { ProtocolDto } from "./protocol-dto.js";
import type { ConflictIssue } from "./review.js";
import type { FactActionId } from "./fact-identities.js";
import type { InlineReferenceTargetStatus } from "./protocol-enums/model.js";
import type {
  ProjectionSection,
  TemplateFieldDefinitionOwner,
  TemplateNodeState,
} from "./protocol-enums/projection.js";

export type TextAtom = Omit<ProtocolDto<ProtocolTextAtom>, "id"> & Readonly<{ kind: "text"; id: TextAtomId }>;
export type ProjectedInlineReference = Omit<ProtocolDto<ProtocolProjectedInlineReference>, "targetStatus"> &
  Readonly<{ kind: "inline-reference"; targetStatus: InlineReferenceTargetStatus }>;
export type NodeContentItem = TextAtom | ProjectedInlineReference;
export type ProjectedNode = Omit<ProtocolDto<ProtocolProjectedNode>, "intrinsicNodeType" | "content"> &
  Readonly<{ intrinsicNodeType: IntrinsicNodeType | null; content: readonly NodeContentItem[] }>;
export type ProjectedOccurrence = ProtocolDto<ProtocolProjectedOccurrence>;
export type MaterializedField = ProtocolDto<ProtocolMaterializedField>;
type TypedFieldValueBase = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
  datatypeNodeId: string;
  valueOccurrenceIds: readonly string[];
}>;
export type TypedFieldSemanticValue =
  | Readonly<{ kind: "number"; valueNodeId: string; valueOccurrenceId: string; value: number }>
  | Readonly<{ kind: "date"; valueNodeId: string; valueOccurrenceId: string; value: string }>
  | Readonly<{ kind: "checkbox"; valueNodeId: string; valueOccurrenceId: string; value: boolean }>
  | Readonly<{
      kind: "options-from-supertag";
      valueNodeId: string;
      valueOccurrenceId: string;
      targetNodeId: string;
    }>;
export type TypedFieldValue = TypedFieldValueBase &
  (
    Readonly<{ state: "empty" | "invalid"; value: null }> | Readonly<{ state: "value"; value: TypedFieldSemanticValue }>
  );
export type ProjectedFieldInitializationExpression = FieldInitializationExpression &
  Readonly<{
    expressionNodeId: string;
    expressionOccurrenceId: string;
    sourceFieldDefinitionOccurrenceId: string;
    contextNodeId: string;
    contextOccurrenceId: string;
  }>;
type FieldDefinitionConfigurationBase = Omit<ProtocolDto<ProtocolFieldDefinitionConfiguration>, "configuration">;
export type FieldDefinitionConfiguration =
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "datatype"; datatypeNodeId: string; optionsSupertagId: string | null }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "cardinality"; cardinalityNodeId: string }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "optionality"; optionalityNodeId: string }>)
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "initialization-expression"; expression: ProjectedFieldInitializationExpression }>);
export type TemplateNodeInstance = Omit<ProtocolDto<ProtocolTemplateNodeInstance>, "state"> &
  Readonly<{ state: TemplateNodeState }>;
export type TemplateFieldVisibilityCandidate = Omit<
  ProtocolDto<ProtocolTemplateFieldVisibilityCandidate>,
  "factActionId" | "visibility"
> &
  Readonly<{ factActionId: FactActionId; visibility: TemplateFieldVisibility }>;
export type TemplateFieldStaticDefaultCandidate = Omit<
  ProtocolDto<ProtocolTemplateFieldStaticDefaultCandidate>,
  "factActionId"
> &
  Readonly<{ factActionId: FactActionId }>;
export type TemplateField = Omit<
  ProtocolDto<ProtocolTemplateField>,
  "factActionId" | "fieldDefinitionOwner" | "visibility" | "visibilityCandidates" | "staticDefaultCandidates"
> &
  Readonly<{
    factActionId: FactActionId;
    fieldDefinitionOwner: TemplateFieldDefinitionOwner;
    visibility: TemplateFieldVisibility;
    visibilityCandidates: readonly TemplateFieldVisibilityCandidate[];
    staticDefaultCandidates: readonly TemplateFieldStaticDefaultCandidate[];
  }>;
export type OptionalFieldContribution = Omit<ProtocolDto<ProtocolOptionalFieldContribution>, "factActionId"> &
  Readonly<{ factActionId: FactActionId }>;
export type EffectiveTemplateFieldSource = Readonly<{
  kind: "template";
  applicationNodeId: string;
  appliedSupertagId: string;
  sourceSupertagId: string;
  extensionPath: readonly string[];
  templateFieldNodeId: string;
  staticDefaultValueNodeId: string;
  visibility: TemplateFieldVisibility;
}>;
export type EffectiveOptionalFieldSource = Readonly<{
  kind: "optional";
  applicationNodeId: string;
  appliedSupertagId: string;
  sourceSupertagId: string;
  extensionPath: readonly string[];
  optionalContributionNodeId: string;
}>;
export type EffectiveFieldSource = EffectiveTemplateFieldSource | EffectiveOptionalFieldSource;
export type StaticDefaultCandidate = Readonly<{
  value: string;
  sourceTemplateFieldNodeIds: readonly string[];
}>;
export type EffectiveStaticDefault =
  | Readonly<{ state: "none"; candidates: readonly [] }>
  | Readonly<{
      state: "value";
      value: string;
      sourceTemplateFieldNodeId: string;
      candidates: readonly StaticDefaultCandidate[];
    }>
  | Readonly<{ state: "conflict"; candidates: readonly StaticDefaultCandidate[] }>;
export type EffectiveField = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  sources: readonly EffectiveFieldSource[];
  staticDefault: EffectiveStaticDefault;
  visibility: TemplateFieldVisibility;
  materializedFieldNodeId: string | null;
  visibilityConflicted: boolean;
}>;
export type OptionalFieldSuggestion = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  sources: readonly EffectiveOptionalFieldSource[];
}>;

export type NodeGraph = Readonly<{
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  childOccurrences: Readonly<Record<string, readonly string[]>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  metanodes: Readonly<Record<string, string>>;
}>;

export type WorkspaceSystemNodeRole = "trash" | "schema" | "systemDefinitionCatalog";
export type WorkspaceSystemNodeProjection = Readonly<{
  workspaceSystemNodes: Readonly<Partial<Record<WorkspaceSystemNodeRole, string>>>;
}>;

export type SupertagProjection = Readonly<{
  supertagApplications: Readonly<Record<string, readonly SupertagApplication[]>>;
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  optionalFieldContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>;
  templateNodeInstances: readonly TemplateNodeInstance[];
  supertagExtensions: Readonly<Record<string, readonly string[]>>;
  supertagInstanceSupertags: Readonly<Record<string, readonly string[]>>;
  supertagExtensionConflicts: Readonly<Record<string, readonly string[]>>;
}>;

export type SupertagApplication = Readonly<{
  hostNodeId: string;
  supertagId: string;
  applicationNodeId: string;
  applicationOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  definitionOccurrenceId: string;
  factActionId: string;
}>;

export type ConflictProjection = Readonly<{
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
}>;

export type FieldProjection = Readonly<{
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  optionalFieldSuggestions: Readonly<Record<string, readonly OptionalFieldSuggestion[]>>;
  fieldDefinitionConfigurations: Readonly<Record<string, readonly FieldDefinitionConfiguration[]>>;
  typedFieldValues: Readonly<Record<string, readonly TypedFieldValue[]>>;
}>;

export type SearchExpression = Readonly<{
  expressionNodeId: string;
  expressionOccurrenceId: string;
  definitionOccurrenceId: string;
  expression: SearchExpressionSpec;
}>;

export type SearchProjection = Readonly<{
  searchExpressions: Readonly<Record<string, SearchExpression>>;
}>;

export type SharedDefaultViewDefinition = Omit<
  ProtocolDto<ProtocolSharedDefaultViewDefinition>,
  "viewId" | "viewType" | "options" | "modeActionIds" | "optionsActionIds"
> &
  Readonly<{
    viewId: FactActionId;
    viewType: ViewType;
    options: ViewOptionsSpec;
    modeActionIds: readonly FactActionId[];
    optionsActionIds: readonly FactActionId[];
  }>;
export type ViewProjection = Readonly<{
  sharedDefaultViewDefinitions: Readonly<Record<string, readonly SharedDefaultViewDefinition[]>>;
}>;

export type ProjectionSections = NodeGraph &
  WorkspaceSystemNodeProjection &
  SupertagProjection &
  ConflictProjection &
  FieldProjection &
  SearchProjection &
  ViewProjection;

export type ProjectionPageSection = ProjectionSection;
export type ProjectionPage<Section extends ProjectionPageSection = ProjectionPageSection> =
  Section extends ProjectionPageSection
    ? Readonly<{
        identity: ProjectionIdentity;
        perspective: ProjectionPerspective;
        section: Section;
        next: string | null;
      }> &
        Readonly<Pick<ProjectionSections, Section>>
    : never;
