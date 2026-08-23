import type {
  FieldInitializationExpression,
  FactActionId,
  ProjectionIdentity,
  ProjectionPerspective,
  ViewType,
} from "../fact/index.js";
import type { SearchExpressionSpec } from "../fact/index.js";
import type { ViewOptionsSpec } from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { NodeGraph } from "./node-graph.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import type { EffectiveField, OptionalFieldSuggestion } from "./effective-field-types.js";

export type {
  EffectiveField,
  EffectiveFieldSource,
  EffectiveOptionalFieldSource,
  EffectiveStaticDefault,
  EffectiveTemplateFieldSource,
  OptionalFieldSuggestion,
  StaticDefaultCandidate,
} from "./effective-field-types.js";

export type { InlineReferenceTargetStatus, ProjectedNode, ProjectedOccurrence, TextAtom } from "./node-graph.js";

export type MaterializedField = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
  definitionOccurrenceId: string;
  valueOccurrenceIds: readonly string[];
}>;

export type TemplateNodeSource = Readonly<{
  supertagId: string;
  appliedSupertagId: string;
  templateOccurrenceId: string;
}>;

export type TemplateNodeInstance = Readonly<{
  ownerNodeId: string;
  templateNodeId: string;
  instanceNodeId: string | null;
  instanceOccurrenceId: string;
  state: "linked" | "detached";
  sources: readonly TemplateNodeSource[];
  detachmentActionIds: readonly FactActionId[];
}>;

export type TemplateField = Readonly<{
  supertagId: string;
  templateFieldNodeId: string;
  templateFieldOccurrenceId: string;
  fieldDefinitionId: string;
  definitionOccurrenceId: string;
  staticDefaultValueNodeId: string;
  staticDefaultValueOccurrenceId: string;
  fieldDefinitionOwner: "template-field" | "workspace-schema";
  factActionId: FactActionId;
  visibility: "normal" | "pinned";
  visibilityCandidates: readonly TemplateFieldVisibilityCandidate[];
  visibilityConflicted: boolean;
  staticDefaultCandidates: readonly TemplateFieldStaticDefaultCandidate[];
  staticDefaultConflicted: boolean;
}>;

type TemplateFieldVisibilityCandidate = Readonly<{
  visibility: "normal" | "pinned";
  factActionId: FactActionId;
}>;

type TemplateFieldStaticDefaultCandidate = Readonly<{
  value: string;
  factActionId: FactActionId;
}>;

export type OptionalFieldContribution = Readonly<{
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
  factActionId: FactActionId;
}>;

type WorkspaceSystemNodeProjection = Readonly<{
  workspaceSystemNodes: WorkspaceSystemNodes;
}>;

type SupertagProjection = Readonly<{
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
  factActionId: FactActionId;
}>;

type ConflictProjection = Readonly<{
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
}>;

type FieldProjection = Readonly<{
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  optionalFieldSuggestions: Readonly<Record<string, readonly OptionalFieldSuggestion[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  fieldDefinitionConfigurations: Readonly<Record<string, readonly FieldDefinitionConfiguration[]>>;
  typedFieldValues: Readonly<Record<string, readonly TypedFieldValue[]>>;
}>;

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

type FieldDefinitionConfigurationBase = Readonly<{
  configurationNodeId: string;
  configurationOccurrenceId: string;
  definitionNodeId: string;
  factActionId: FactActionId;
}>;

type ProjectedFieldInitializationExpression = FieldInitializationExpression &
  Readonly<{
    expressionNodeId: string;
    expressionOccurrenceId: string;
    sourceFieldDefinitionOccurrenceId: string;
    contextNodeId: string;
    contextOccurrenceId: string;
  }>;

export type FieldDefinitionConfiguration =
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "datatype"; datatypeNodeId: string; optionsSupertagId: string | null }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "cardinality"; cardinalityNodeId: string }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "optionality"; optionalityNodeId: string }>)
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "initialization-expression"; expression: ProjectedFieldInitializationExpression }>);

export type SearchExpression = Readonly<{
  expressionNodeId: string;
  expressionOccurrenceId: string;
  definitionOccurrenceId: string;
  expression: SearchExpressionSpec;
}>;

type SearchProjection = Readonly<{
  searchExpressions: Readonly<Record<string, SearchExpression>>;
}>;

export type SharedDefaultViewDefinition = Readonly<{
  viewId: FactActionId;
  hostNodeId: string;
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  viewType: ViewType;
  modeActionIds: readonly FactActionId[];
  options: ViewOptionsSpec;
  optionsActionIds: readonly FactActionId[];
  optionsConflicted: boolean;
}>;

type ViewProjection = Readonly<{
  sharedDefaultViewDefinitions: Readonly<Record<string, readonly SharedDefaultViewDefinition[]>>;
}>;

export type ProjectionSections = NodeGraph &
  WorkspaceSystemNodeProjection &
  SupertagProjection &
  ConflictProjection &
  FieldProjection &
  SearchProjection &
  ViewProjection;

export const PROJECTION_SECTION_NAMES = [
  "nodes",
  "occurrences",
  "childOccurrences",
  "nodeOwners",
  "metanodes",
  "workspaceSystemNodes",
  "supertagApplications",
  "supertagTemplateNodes",
  "templateFields",
  "optionalFieldContributions",
  "templateNodeInstances",
  "supertagExtensions",
  "supertagInstanceSupertags",
  "supertagExtensionConflicts",
  "conflictIssues",
  "materializedFields",
  "effectiveFields",
  "optionalFieldSuggestions",
  "fieldDefinitionConfigurations",
  "typedFieldValues",
  "searchExpressions",
  "sharedDefaultViewDefinitions",
] as const satisfies readonly (keyof ProjectionSections)[];

type AssertNever<Value extends never> = Value;
export type ProjectionSectionName =
  AssertNever<Exclude<keyof ProjectionSections, (typeof PROJECTION_SECTION_NAMES)[number]>> extends never
    ? (typeof PROJECTION_SECTION_NAMES)[number]
    : never;

export type ProjectionSectionValue<Section extends ProjectionSectionName = ProjectionSectionName> =
  Section extends ProjectionSectionName
    ? ProjectionSections[Section] extends readonly (infer Item)[]
      ? Item
      : ProjectionSections[Section] extends Readonly<Record<string, infer Item>>
        ? Item
        : never
    : never;

export type Projection = Readonly<{
  perspective: ProjectionPerspective;
  identity: ProjectionIdentity;
}> &
  ProjectionSections;

export type ProjectionGeneration = Readonly<{
  identity: ProjectionIdentity;
  origin: Projection;
  review: Projection;
  planCaches: Readonly<{
    origin: ProjectionPlanCache;
    review: ProjectionPlanCache;
  }>;
}>;

type ScopedProjectionSectionName = Exclude<ProjectionSectionName, "conflictIssues">;

export type ScopedProjection = Readonly<{
  perspective: ProjectionPerspective;
  identity: ProjectionIdentity;
}> &
  Pick<ProjectionSections, ScopedProjectionSectionName>;

export type ScopedProjectionGeneration = Readonly<{
  identity: ProjectionIdentity;
  origin: ScopedProjection;
  review: ScopedProjection;
}>;

export type ProjectionPlanCache = Readonly<{
  activeActionIds: readonly FactActionId[];
  supportByAction: Readonly<Record<string, readonly FactActionId[]>>;
}>;

export type ProjectionVersions = Readonly<{
  rulesVersion: string;
  schemaVersion: string;
}>;

export const CURRENT_PROJECTION_VERSIONS: ProjectionVersions = {
  rulesVersion: "proposal-rules-1",
  schemaVersion: "lode-schema-1",
};

export function assertSupportedProjectionVersions(versions: ProjectionVersions): void {
  if (
    versions.rulesVersion !== CURRENT_PROJECTION_VERSIONS.rulesVersion ||
    versions.schemaVersion !== CURRENT_PROJECTION_VERSIONS.schemaVersion
  ) {
    throw new Error(`Unsupported projection versions: ${versions.rulesVersion}/${versions.schemaVersion}`);
  }
}
