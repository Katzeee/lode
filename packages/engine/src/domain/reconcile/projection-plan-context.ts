import type {
  ContributionFact,
  FactSnapshot,
  JsonValue,
  ProjectionIdentity,
  ViewMode,
} from "../fact/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { projectionIdentity } from "./projection-identity.js";
import type {
  EffectiveField,
  MaterializedField,
  NodeStatus,
  Projection,
  ProjectionPlanCache,
  ProjectionVersions,
  TemplateField,
  TemplateNodeInstance,
} from "./projection-types.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { stripProjectedValues } from "./projection-value-assembly.js";

export type ProjectionStageObserver = (stage: ProjectionStageKey, view: ViewMode) => void;

export type ProjectionPlanContext = {
  readonly snapshot: FactSnapshot;
  readonly view: ViewMode;
  active: readonly ContributionFact[];
  allActive: readonly ContributionFact[];
  readonly incremental: boolean;
  readonly requiresAllActive: boolean;
  readonly replayAllActive: boolean;
  readonly previousPlanCache: ProjectionPlanCache;
  readonly observer?: ProjectionStageObserver;
  identity: ProjectionIdentity;
  workspaceNodeId: string;
  nodes: Map<string, MutableNode>;
  occurrences: Map<string, MutableOccurrence>;
  children: Map<string, string[]>;
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  nodeOwners: Readonly<Record<string, string | null>>;
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
  reviewScopes: Readonly<Record<string, readonly string[]>>;
  supportByContribution: Readonly<Record<string, readonly string[]>>;
  managedTextReplayNodeIds: ReadonlySet<string>;
  projection: Projection | null;
  planCache: ProjectionPlanCache;
};

export function emptyProjectionPlanContext(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionStageObserver,
): ProjectionPlanContext {
  return {
    snapshot,
    view,
    active: [],
    allActive: [],
    incremental: false,
    requiresAllActive: true,
    replayAllActive: false,
    ...(observer ? { observer } : {}),
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    nodes: new Map(),
    occurrences: new Map(),
    children: new Map(),
    addressedValues: {},
    nodeOwners: {},
    schemaApplications: {},
    schemaFields: {},
    templateFields: {},
    schemaTemplateNodes: {},
    templateNodeInstances: [],
    schemaExtensions: {},
    schemaSearchMembers: {},
    schemaExtensionConflicts: {},
    nodeStatuses: {},
    conflictIssues: {},
    effectiveFields: {},
    materializedFields: {},
    reviewScopes: {},
    supportByContribution: {},
    managedTextReplayNodeIds: new Set(),
    projection: null,
    planCache: { activeContributionIds: [], supportByContribution: {}, supportPasses: 0 },
    previousPlanCache: { activeContributionIds: [], supportByContribution: {}, supportPasses: 0 },
  };
}

export function incrementalProjectionPlanContext(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionPlanCache,
  snapshot: FactSnapshot,
  active: readonly ContributionFact[],
  versions: ProjectionVersions,
  selected: ReadonlySet<ProjectionStageKey>,
  observer?: ProjectionStageObserver,
): ProjectionPlanContext {
  const stripped = stripProjectedValues(
    previous.nodes,
    previous.occurrences,
    previous.addressedValues,
  );
  const replayAllActive = selected.has("node") || selected.has("occurrence");
  return {
    snapshot,
    view: previous.view,
    active,
    allActive: [],
    incremental: true,
    requiresAllActive: replayAllActive || selected.has("schema"),
    replayAllActive,
    ...(observer ? { observer } : {}),
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    nodes: stripped.nodes,
    occurrences: stripped.occurrences,
    children: new Map(
      Object.entries(previous.children).map(([id, children]) => [id, [...children]]),
    ),
    addressedValues: Object.fromEntries(
      Object.entries(previous.addressedValues).map(([address, values]) => [address, { ...values }]),
    ),
    nodeOwners: { ...previous.nodeOwners },
    schemaApplications: previous.schemaApplications,
    schemaFields: previous.schemaFields,
    templateFields: previous.templateFields,
    schemaTemplateNodes: previous.schemaTemplateNodes,
    templateNodeInstances: [...previous.templateNodeInstances],
    schemaExtensions: previous.schemaExtensions,
    schemaSearchMembers: previous.schemaSearchMembers,
    schemaExtensionConflicts: previous.schemaExtensionConflicts,
    nodeStatuses: previous.nodeStatuses,
    conflictIssues: previous.conflictIssues,
    effectiveFields: previous.effectiveFields,
    materializedFields: previous.materializedFields,
    reviewScopes: previous.reviewScopes,
    supportByContribution: previous.supportByContribution,
    managedTextReplayNodeIds: new Set(),
    projection: null,
    planCache: previousCache,
    previousPlanCache: previousCache,
  };
}
