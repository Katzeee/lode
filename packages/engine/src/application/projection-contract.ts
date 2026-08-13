import type { JsonValue, ProjectionIdentity, ViewMode } from "../domain/fact/index.js";
import type {
  NodeStatus,
  EffectiveField,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
  TemplateField,
  TemplateNodeInstance,
} from "../domain/reconcile/index.js";
import type { ConflictIssue } from "../domain/conflict/index.js";

export type ProjectionPageSection =
  | "nodes"
  | "occurrences"
  | "children"
  | "nodeOwners"
  | "addressedValues"
  | "schemaApplications"
  | "schemaFields"
  | "templateFields"
  | "schemaTemplateNodes"
  | "templateNodeInstances"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "nodeStatuses"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields";

export type ProjectionPageValue =
  | ProjectedNode
  | ProjectedOccurrence
  | readonly string[]
  | string
  | Readonly<Record<string, JsonValue>>
  | readonly EffectiveField[]
  | readonly MaterializedField[]
  | readonly TemplateField[]
  | null
  | TemplateNodeInstance
  | NodeStatus
  | ConflictIssue;

export type ProjectionPage = Readonly<{
  identity: ProjectionIdentity;
  view: ViewMode;
  section: ProjectionPageSection;
  entries: readonly Readonly<{ identity: string; value: ProjectionPageValue }>[];
  next: string | null;
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
