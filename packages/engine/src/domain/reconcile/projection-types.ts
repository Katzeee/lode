import type {
  SupertagFieldConfig,
  FieldValueSeed,
  FieldVisibility,
  FieldCardinality,
  FieldDatatype,
  FieldInitializationExpression,
  ProjectionIdentity,
  ProjectionPerspective,
  ViewType,
} from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { NodeGraph } from "./node-graph.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export type {
  InlineReferenceTargetStatus,
  NodeContentItem,
  NodeGraph,
  ProjectedInlineReference,
  ProjectedNode,
  ProjectedOccurrence,
  TextAtom,
} from "./node-graph.js";

export type FieldConfigCandidate = Readonly<{
  config: SupertagFieldConfig;
  sourceSupertagIds: readonly string[];
  sourceFieldNodeIds: readonly string[];
  contributionIds: readonly string[];
}>;

export type FieldInitializationCandidate = Readonly<{
  initializationId: string;
  supertagId: string;
  source: "static-default" | "auto-initialize";
  values: readonly FieldValueSeed[];
}>;

export type TemplateField = Readonly<{
  fieldNodeId: string;
  fieldOccurrenceId: string;
  supertagId: string;
  fieldDefinitionId: string;
  configCandidates: readonly FieldConfigCandidate[];
  effectiveConfig: SupertagFieldConfig | null;
}>;

export type EffectiveField = Readonly<{
  fieldDefinitionId: string;
  sourceSupertagIds: readonly string[];
  sourceFieldNodeIds: readonly string[];
  visibility: FieldVisibility;
  configCandidates: readonly FieldConfigCandidate[];
  effectiveConfig: SupertagFieldConfig | null;
  initializationCandidates: readonly FieldInitializationCandidate[];
  initializedValues: readonly FieldValueSeed[] | null;
  materializedFieldNodeId: string | null;
}>;

export type MaterializedField = Readonly<{
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
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
  detachmentContributionIds: readonly string[];
}>;

export type WorkspaceSystemNodeProjection = Readonly<{
  workspaceSystemNodes: WorkspaceSystemNodes;
}>;

export type SupertagProjection = Readonly<{
  supertagApplications: Readonly<Record<string, readonly string[]>>;
  supertagFields: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>;
  templateNodeInstances: readonly TemplateNodeInstance[];
  supertagExtensions: Readonly<Record<string, readonly string[]>>;
  supertagInstanceSupertags: Readonly<Record<string, readonly string[]>>;
  supertagExtensionConflicts: Readonly<Record<string, readonly string[]>>;
}>;

export type ConflictProjection = Readonly<{
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
}>;

export type FieldProjection = Readonly<{
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  fieldDefinitionConfigurations: Readonly<Record<string, readonly FieldDefinitionConfiguration[]>>;
}>;

type FieldDefinitionConfigurationBase = Readonly<{
  configurationNodeId: string;
  configurationOccurrenceId: string;
  contributionId: string;
}>;

export type FieldDefinitionConfiguration =
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "datatype"; datatype: FieldDatatype }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "cardinality"; cardinality: FieldCardinality }>)
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>);

export type SearchClause =
  | Readonly<{
      kind: "supertag-instance-of";
      clauseNodeId: string;
      clauseOccurrenceId: string;
      supertagId: string;
    }>
  | Readonly<{
      kind: "field-defined";
      clauseNodeId: string;
      clauseOccurrenceId: string;
      fieldDefinitionId: string;
    }>;

export type SearchProjection = Readonly<{
  searchClauses: Readonly<Record<string, readonly SearchClause[]>>;
}>;

export type SharedDefaultViewDefinition = Readonly<{
  hostNodeId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  viewType: ViewType;
  modeContributionIds: readonly string[];
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

export const PROJECTION_SECTION_NAMES = [
  "nodes",
  "occurrences",
  "childOccurrences",
  "nodeOwners",
  "metanodes",
  "workspaceSystemNodes",
  "supertagApplications",
  "supertagFields",
  "templateFields",
  "supertagTemplateNodes",
  "templateNodeInstances",
  "supertagExtensions",
  "supertagInstanceSupertags",
  "supertagExtensionConflicts",
  "conflictIssues",
  "effectiveFields",
  "materializedFields",
  "fieldDefinitionConfigurations",
  "searchClauses",
  "sharedDefaultViewDefinitions",
] as const satisfies readonly (keyof ProjectionSections)[];

type AssertNever<Value extends never> = Value;
export type ProjectionSectionNamesAreComplete = AssertNever<
  Exclude<keyof ProjectionSections, (typeof PROJECTION_SECTION_NAMES)[number]>
>;

export type ProjectionSectionName = (typeof PROJECTION_SECTION_NAMES)[number];

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

export type ScopedProjectionSectionName = Exclude<ProjectionSectionName, "conflictIssues">;

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
  activeContributionIds: readonly string[];
  supportByContribution: Readonly<Record<string, readonly string[]>>;
  supportPasses: number;
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
