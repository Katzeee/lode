import type { ContributionFact, FactSnapshot, ProjectionIdentity, ViewMode } from "../fact/index.js";
import type { ProjectionReplayPolicy } from "./projection-rule.js";
import { projectionIdentity } from "./projection-identity.js";
import type { Projection, ProjectionPlanCache, ProjectionSections, ProjectionVersions } from "./projection-types.js";
import type { AuthoredStructure, MutableNode } from "./projection-state.js";
import { cloneNodes } from "./node-state.js";
import { stripProjectedValues } from "./projection-value-assembly.js";
import {
  authoredStructureWithoutProjectedTemplates,
  type TemplateStructureProjection,
} from "./template-node-projection.js";
import type { SchemaRelations } from "./schema-relations.js";

export type ProjectionActivation = Readonly<{
  active: readonly ContributionFact[];
  allActive: readonly ContributionFact[];
  planCache: ProjectionPlanCache;
}>;

export type ProjectionPlanContext = {
  readonly snapshot: FactSnapshot;
  readonly view: ViewMode;
  readonly activeTail: readonly ContributionFact[];
  readonly incremental: boolean;
  readonly requiresAllActive: boolean;
  readonly replayAllActive: boolean;
  readonly previousPlanCache: ProjectionPlanCache;
  readonly identity: ProjectionIdentity;
  readonly workspaceNodeId: string;
  activation: ProjectionActivation;
  storedNodes: Map<string, MutableNode>;
  contentNodes: Map<string, MutableNode>;
  authoredStructure: AuthoredStructure;
  templateStructure: TemplateStructureProjection;
  addressedValues: ProjectionSections["addressedValues"];
  nodeOwners: ProjectionSections["nodeOwners"];
  schemaRelations: SchemaRelations;
  nodeStatuses: ProjectionSections["nodeStatuses"];
  conflictIssues: ProjectionSections["conflictIssues"];
  projection: Projection | null;
};

export function emptyProjectionPlanContext(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
): ProjectionPlanContext {
  return {
    snapshot,
    view,
    activeTail: [],
    incremental: false,
    requiresAllActive: true,
    replayAllActive: false,
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    activation: {
      active: [],
      allActive: [],
      planCache: { activeContributionIds: [], supportByContribution: {}, supportPasses: 0 },
    },
    storedNodes: new Map(),
    contentNodes: new Map(),
    authoredStructure: { occurrences: new Map(), children: new Map() },
    templateStructure: { occurrences: new Map(), children: new Map(), instances: [] },
    addressedValues: {},
    nodeOwners: {},
    schemaRelations: emptySchemaRelations(),
    nodeStatuses: {},
    conflictIssues: {},
    projection: null,
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
  replayPolicy: ProjectionReplayPolicy,
): ProjectionPlanContext {
  const stripped = stripProjectedValues(previous.nodes, previous.occurrences, previous.addressedValues);
  const effectiveChildren = new Map(Object.entries(previous.children).map(([id, children]) => [id, [...children]]));
  const authored = authoredStructureWithoutProjectedTemplates(
    previous.templateNodeInstances,
    stripped.occurrences,
    effectiveChildren,
  );
  const { replayAllActive, requiresAllActive } = replayPolicy;
  return {
    snapshot,
    view: previous.view,
    activeTail: active,
    incremental: true,
    requiresAllActive,
    replayAllActive,
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    activation: { active, allActive: [], planCache: previousCache },
    storedNodes: cloneNodes(stripped.nodes),
    contentNodes: stripped.nodes,
    authoredStructure: authored,
    templateStructure: {
      occurrences: stripped.occurrences,
      children: effectiveChildren,
      instances: [...previous.templateNodeInstances],
    },
    addressedValues: Object.fromEntries(
      Object.entries(previous.addressedValues).map(([address, values]) => [address, { ...values }]),
    ),
    nodeOwners: { ...previous.nodeOwners },
    schemaRelations: {
      schemaApplications: previous.schemaApplications,
      schemaFields: previous.schemaFields,
      templateFields: previous.templateFields,
      schemaTemplateNodes: previous.schemaTemplateNodes,
      schemaExtensions: previous.schemaExtensions,
      schemaSearchMembers: previous.schemaSearchMembers,
      schemaExtensionConflicts: previous.schemaExtensionConflicts,
      effectiveFields: previous.effectiveFields,
      materializedFields: previous.materializedFields,
    },
    nodeStatuses: previous.nodeStatuses,
    conflictIssues: previous.conflictIssues,
    projection: null,
    previousPlanCache: previousCache,
  };
}

function emptySchemaRelations(): SchemaRelations {
  return {
    schemaApplications: {},
    schemaFields: {},
    templateFields: {},
    schemaTemplateNodes: {},
    schemaExtensions: {},
    schemaSearchMembers: {},
    schemaExtensionConflicts: {},
    effectiveFields: {},
    materializedFields: {},
  };
}
