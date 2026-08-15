import type {
  FieldTemplateConfig,
  FieldValueSeed,
  FieldVisibility,
  JsonValue,
  NodeType,
  ProjectionIdentity,
  TextAtomId,
  ViewMode,
} from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";

export type TextAtom = Readonly<{
  id: TextAtomId;
  value: string;
  attributes: Readonly<Record<string, JsonValue>>;
  contributionId: string;
}>;

export type ProjectedNode = Readonly<{
  nodeId: string;
  text: readonly TextAtom[];
  properties: Readonly<Record<string, JsonValue>>;
  metadata: Readonly<Record<string, JsonValue>>;
}>;

export type ProjectedOccurrence = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
  properties: Readonly<Record<string, JsonValue>>;
  metadata: Readonly<Record<string, JsonValue>>;
  derived: boolean;
}>;

export type FieldConfigCandidate = Readonly<{
  config: FieldTemplateConfig;
  sourceSchemaIds: readonly string[];
  sourceFieldNodeIds: readonly string[];
  contributionIds: readonly string[];
}>;

export type FieldInitializationCandidate = Readonly<{
  initializationId: string;
  schemaId: string;
  source: "static-default" | "auto-initialize";
  values: readonly FieldValueSeed[];
}>;

export type TemplateField = Readonly<{
  fieldNodeId: string;
  fieldOccurrenceId: string;
  schemaId: string;
  fieldDefinitionId: string;
  configCandidates: readonly FieldConfigCandidate[];
  effectiveConfig: FieldTemplateConfig | null;
}>;

export type EffectiveField = Readonly<{
  fieldDefinitionId: string;
  sourceSchemaIds: readonly string[];
  sourceFieldNodeIds: readonly string[];
  visibility: FieldVisibility;
  configCandidates: readonly FieldConfigCandidate[];
  effectiveConfig: FieldTemplateConfig | null;
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

export type NodeStatus = Readonly<{
  nodeId: string;
  nodeType: NodeType | null;
  state: "active" | "deleted";
  deletionFactIds: readonly string[];
}>;

export type TemplateNodeSource = Readonly<{
  schemaId: string;
  appliedSchemaId: string;
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

export type ProjectionSections = Readonly<{
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  children: Readonly<Record<string, readonly string[]>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  schemaTemplateNodes: Readonly<Record<string, readonly string[]>>;
  templateNodeInstances: readonly TemplateNodeInstance[];
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  nodeStatuses: Readonly<Record<string, NodeStatus>>;
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
}>;

export const PROJECTION_SECTION_NAMES = [
  "nodes",
  "occurrences",
  "children",
  "nodeOwners",
  "addressedValues",
  "schemaApplications",
  "schemaFields",
  "templateFields",
  "schemaTemplateNodes",
  "templateNodeInstances",
  "schemaExtensions",
  "schemaSearchMembers",
  "schemaExtensionConflicts",
  "nodeStatuses",
  "conflictIssues",
  "effectiveFields",
  "materializedFields",
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
  view: ViewMode;
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
  view: ViewMode;
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
  rulesVersion: "proposal-rules-5",
  schemaVersion: "lode-schema-19",
};

export function assertSupportedProjectionVersions(versions: ProjectionVersions): void {
  if (
    versions.rulesVersion !== CURRENT_PROJECTION_VERSIONS.rulesVersion ||
    versions.schemaVersion !== CURRENT_PROJECTION_VERSIONS.schemaVersion
  ) {
    throw new Error(`Unsupported projection versions: ${versions.rulesVersion}/${versions.schemaVersion}`);
  }
}
