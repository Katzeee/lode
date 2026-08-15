import type {
  EffectiveField as ProtocolEffectiveField,
  FieldConfigCandidate as ProtocolFieldConfigCandidate,
  FieldInitializationCandidate as ProtocolFieldInitializationCandidate,
  MaterializedField as ProtocolMaterializedField,
  NodeStatus as ProtocolNodeStatus,
  ProjectedNode as ProtocolProjectedNode,
  ProjectedOccurrence as ProtocolProjectedOccurrence,
  TemplateField as ProtocolTemplateField,
  TemplateNodeInstance as ProtocolTemplateNodeInstance,
  TextAtom as ProtocolTextAtom,
} from "@lode/protocol/dto/projection";
import { ProjectionPageSchema } from "@lode/protocol/proto";
import type {
  FieldTemplateConfig,
  FieldValueSeed,
  FieldVisibility,
  JsonValue,
  NodeType,
  ProjectionIdentity,
  ProtocolDto,
  ViewMode,
} from "./model.js";
import type { ConflictIssue } from "./review.js";
import type { FieldInitializationSource } from "./protocol-enums/model.js";
import type { NodeState, ProjectionSection, TemplateNodeState } from "./protocol-enums/projection.js";

export type TextAtom = ProtocolDto<ProtocolTextAtom>;
export type ProjectedNode = ProtocolDto<ProtocolProjectedNode>;
export type ProjectedOccurrence = ProtocolDto<ProtocolProjectedOccurrence>;
export type FieldConfigCandidate = Omit<ProtocolDto<ProtocolFieldConfigCandidate>, "config"> &
  Readonly<{ config: FieldTemplateConfig }>;
export type FieldInitializationCandidate = Omit<
  ProtocolDto<ProtocolFieldInitializationCandidate>,
  "source" | "values"
> &
  Readonly<{ source: FieldInitializationSource; values: readonly FieldValueSeed[] }>;
export type TemplateField = Omit<ProtocolDto<ProtocolTemplateField>, "configCandidates" | "effectiveConfig"> &
  Readonly<{
    configCandidates: readonly FieldConfigCandidate[];
    effectiveConfig: FieldTemplateConfig | null;
  }>;
export type EffectiveField = Omit<
  ProtocolDto<ProtocolEffectiveField>,
  "visibility" | "configCandidates" | "effectiveConfig" | "initializationCandidates" | "initializedValues"
> &
  Readonly<{
    visibility: FieldVisibility;
    configCandidates: readonly FieldConfigCandidate[];
    effectiveConfig: FieldTemplateConfig | null;
    initializationCandidates: readonly FieldInitializationCandidate[];
    initializedValues: readonly FieldValueSeed[] | null;
  }>;
export type MaterializedField = ProtocolDto<ProtocolMaterializedField>;
export type NodeStatus = Omit<ProtocolDto<ProtocolNodeStatus>, "nodeType" | "state"> &
  Readonly<{ nodeType: NodeType | null; state: NodeState }>;
export type TemplateNodeInstance = Omit<ProtocolDto<ProtocolTemplateNodeInstance>, "state"> &
  Readonly<{ state: TemplateNodeState }>;

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
        view: ViewMode;
        section: Section;
        next: string | null;
      }> &
        Readonly<Pick<ProjectionSections, Section>>
    : never;
