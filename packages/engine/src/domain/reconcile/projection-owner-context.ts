import type {
  ContributionFact,
  FactSnapshot,
  JsonValue,
  ProjectionIdentity,
  ViewMode,
} from "../fact/index.js";
import type { OwnerKey } from "./owner-dag.js";
import { projectionIdentity } from "./projection-identity.js";
import type {
  ManagedChild,
  EffectiveField,
  MaterializedField,
  Projection,
  ProjectionOwnerCache,
  ProjectionVersions,
  SchemaFieldItem,
} from "./projection-types.js";
import type { ConflictIssue } from "../conflict/types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { stripProjectedValues } from "./projection-value-assembly.js";

export type ProjectionOwnerObserver = (owner: OwnerKey, view: ViewMode) => void;

export type ProjectionOwnerContext = {
  readonly snapshot: FactSnapshot;
  readonly view: ViewMode;
  active: readonly ContributionFact[];
  allActive: readonly ContributionFact[];
  readonly incremental: boolean;
  readonly requiresAllActive: boolean;
  readonly replayAllActive: boolean;
  readonly previousOwnerCache: ProjectionOwnerCache;
  readonly observer?: ProjectionOwnerObserver;
  identity: ProjectionIdentity;
  nodes: Map<string, MutableNode>;
  occurrences: Map<string, MutableOccurrence>;
  children: Map<string, string[]>;
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  canonicalOccurrences: Readonly<Record<string, string>>;
  managedChildren: readonly ManagedChild[];
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>;
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  managedTextReplayNodeIds: ReadonlySet<string>;
  projection: Projection | null;
  ownerCache: ProjectionOwnerCache;
};

export function emptyOwnerContext(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionOwnerObserver,
): ProjectionOwnerContext {
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
    nodes: new Map(),
    occurrences: new Map(),
    children: new Map(),
    addressedValues: {},
    canonicalOccurrences: {},
    managedChildren: [],
    schemaApplications: {},
    schemaFields: {},
    schemaFieldItems: {},
    schemaExtensions: {},
    schemaSearchMembers: {},
    schemaExtensionConflicts: {},
    conflictIssues: {},
    effectiveFields: {},
    materializedFields: {},
    managedTextReplayNodeIds: new Set(),
    projection: null,
    ownerCache: { activeContributionIds: [], supportPasses: 0 },
    previousOwnerCache: { activeContributionIds: [], supportPasses: 0 },
  };
}

export function incrementalOwnerContext(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionOwnerCache,
  snapshot: FactSnapshot,
  active: readonly ContributionFact[],
  versions: ProjectionVersions,
  selected: ReadonlySet<OwnerKey>,
  observer?: ProjectionOwnerObserver,
): ProjectionOwnerContext {
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
    nodes: stripped.nodes,
    occurrences: stripped.occurrences,
    children: new Map(
      Object.entries(previous.children).map(([id, children]) => [id, [...children]]),
    ),
    addressedValues: Object.fromEntries(
      Object.entries(previous.addressedValues).map(([address, values]) => [address, { ...values }]),
    ),
    canonicalOccurrences: { ...previous.canonicalOccurrences },
    managedChildren: [...previous.managedChildren],
    schemaApplications: previous.schemaApplications,
    schemaFields: previous.schemaFields,
    schemaFieldItems: previous.schemaFieldItems,
    schemaExtensions: previous.schemaExtensions,
    schemaSearchMembers: previous.schemaSearchMembers,
    schemaExtensionConflicts: previous.schemaExtensionConflicts,
    conflictIssues: previous.conflictIssues,
    effectiveFields: previous.effectiveFields,
    materializedFields: previous.materializedFields,
    managedTextReplayNodeIds: new Set(),
    projection: null,
    ownerCache: previousCache,
    previousOwnerCache: previousCache,
  };
}
