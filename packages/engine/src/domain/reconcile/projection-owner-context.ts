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
  Projection,
  ProjectionOwnerCache,
  ProjectionVersions,
} from "./projection-types.js";
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
    managedTextReplayNodeIds: new Set(),
    projection: null,
    ownerCache: previousCache,
    previousOwnerCache: previousCache,
  };
}
