import type {
  EffectiveField as ProtocolEffectiveField,
  FieldConfigCandidate as ProtocolFieldConfigCandidate,
  FieldInitializationCandidate as ProtocolFieldInitializationCandidate,
  MaterializedField as ProtocolMaterializedField,
  ProjectedNode as ProtocolProjectedNode,
  ProjectedOccurrence as ProtocolProjectedOccurrence,
  TemplateField as ProtocolTemplateField,
  TemplateNodeInstance as ProtocolTemplateNodeInstance,
  TextAtom as ProtocolTextAtom,
  ProjectedInlineReference as ProtocolProjectedInlineReference,
  SharedDefaultViewDefinition as ProtocolSharedDefaultViewDefinition,
  FieldDefinitionConfiguration as ProtocolFieldDefinitionConfiguration,
} from "@lode/protocol/dto/projection";
import { ProjectionPageSchema } from "@lode/protocol/proto";
import type {
  SupertagFieldConfig,
  FieldValueSeed,
  FieldVisibility,
  NodeType,
  ProjectionIdentity,
  ProtocolDto,
  ProjectionPerspective,
  TextAtomId,
  ViewType,
  FieldDatatype,
  FieldCardinality,
  FieldInitializationExpression,
} from "./model.js";
import type { ConflictIssue } from "./review.js";
import type { FieldInitializationSource } from "./protocol-enums/model.js";
import type { InlineReferenceTargetStatus } from "./protocol-enums/model.js";
import type { ProjectionSection, TemplateNodeState } from "./protocol-enums/projection.js";

export type TextAtom = Omit<ProtocolDto<ProtocolTextAtom>, "id"> & Readonly<{ kind: "text"; id: TextAtomId }>;
export type ProjectedInlineReference = Omit<ProtocolDto<ProtocolProjectedInlineReference>, "targetStatus"> &
  Readonly<{ kind: "inline-reference"; targetStatus: InlineReferenceTargetStatus }>;
export type NodeContentItem = TextAtom | ProjectedInlineReference;
export type ProjectedNode = Omit<ProtocolDto<ProtocolProjectedNode>, "nodeType" | "content"> &
  Readonly<{ nodeType: NodeType | null; content: readonly NodeContentItem[] }>;
export type ProjectedOccurrence = ProtocolDto<ProtocolProjectedOccurrence>;
export type FieldConfigCandidate = Omit<ProtocolDto<ProtocolFieldConfigCandidate>, "config"> &
  Readonly<{ config: SupertagFieldConfig }>;
export type FieldInitializationCandidate = Omit<
  ProtocolDto<ProtocolFieldInitializationCandidate>,
  "source" | "values"
> &
  Readonly<{ source: FieldInitializationSource; values: readonly FieldValueSeed[] }>;
export type TemplateField = Omit<ProtocolDto<ProtocolTemplateField>, "configCandidates" | "effectiveConfig"> &
  Readonly<{
    configCandidates: readonly FieldConfigCandidate[];
    effectiveConfig: SupertagFieldConfig | null;
  }>;
export type EffectiveField = Omit<
  ProtocolDto<ProtocolEffectiveField>,
  "visibility" | "configCandidates" | "effectiveConfig" | "initializationCandidates" | "initializedValues"
> &
  Readonly<{
    visibility: FieldVisibility;
    configCandidates: readonly FieldConfigCandidate[];
    effectiveConfig: SupertagFieldConfig | null;
    initializationCandidates: readonly FieldInitializationCandidate[];
    initializedValues: readonly FieldValueSeed[] | null;
  }>;
export type MaterializedField = ProtocolDto<ProtocolMaterializedField>;
type FieldDefinitionConfigurationBase = Omit<ProtocolDto<ProtocolFieldDefinitionConfiguration>, "configuration">;
export type FieldDefinitionConfiguration =
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "datatype"; datatype: FieldDatatype }>)
  | (FieldDefinitionConfigurationBase & Readonly<{ kind: "cardinality"; cardinality: FieldCardinality }>)
  | (FieldDefinitionConfigurationBase &
      Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>);
export type TemplateNodeInstance = Omit<ProtocolDto<ProtocolTemplateNodeInstance>, "state"> &
  Readonly<{ state: TemplateNodeState }>;

export type NodeGraph = Readonly<{
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  childOccurrences: Readonly<Record<string, readonly string[]>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  metanodes: Readonly<Record<string, string>>;
}>;

export type WorkspaceSystemNodeRole = "trash";
export type WorkspaceSystemNodeProjection = Readonly<{
  workspaceSystemNodes: Readonly<Partial<Record<WorkspaceSystemNodeRole, string>>>;
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

export type SharedDefaultViewDefinition = Omit<ProtocolDto<ProtocolSharedDefaultViewDefinition>, "viewType"> &
  Readonly<{ viewType: ViewType; modeContributionIds: readonly string[] }>;
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
export const PROJECTION_PAGE_SECTIONS = (ProjectionPageSchema.oneofs[0]?.fields.map(
  (field) => field.localName as ProjectionPageSection,
) ?? []) satisfies readonly (keyof ProjectionSections)[];
export type ProjectionPageValue<Section extends ProjectionPageSection = ProjectionPageSection> =
  Section extends ProjectionPageSection
    ? ProjectionSections[Section] extends readonly (infer Item)[]
      ? Item
      : ProjectionSections[Section] extends Readonly<Record<string, infer Item>>
        ? Item
        : never
    : never;
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
