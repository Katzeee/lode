import type { ContributionFact, FactSnapshot, ProjectionIdentity, ProjectionPerspective } from "../fact/index.js";
import type { ProjectionReplayPolicy } from "./projection-rule.js";
import { projectionIdentity } from "./projection-identity.js";
import type { Projection, ProjectionPlanCache, ProjectionSections, ProjectionVersions } from "./projection-types.js";
import type { AuthoredStructure, MutableNode } from "./projection-state.js";
import { cloneNodes } from "./node-state.js";
import {
  authoredStructureWithoutProjectedTemplates,
  type TemplateStructureProjection,
} from "./template-node-projection.js";
import type { SupertagRelations } from "./supertag-relations.js";
import type { NodeGraphStructure } from "./trash-structure.js";

export type ProjectionActivation = Readonly<{
  active: readonly ContributionFact[];
  allActive: readonly ContributionFact[];
  planCache: ProjectionPlanCache;
}>;

export type ProjectionPlanContext = {
  readonly snapshot: FactSnapshot;
  readonly perspective: ProjectionPerspective;
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
  metanodes: ProjectionSections["metanodes"];
  templateStructure: TemplateStructureProjection;
  nodeOwners: ProjectionSections["nodeOwners"];
  nodeGraphStructure: NodeGraphStructure;
  supertagRelations: SupertagRelations;
  searchClauses: ProjectionSections["searchClauses"];
  sharedDefaultViewDefinitions: ProjectionSections["sharedDefaultViewDefinitions"];
  fieldDefinitionConfigurations: ProjectionSections["fieldDefinitionConfigurations"];
  conflictIssues: ProjectionSections["conflictIssues"];
  projection: Projection | null;
};

export function emptyProjectionPlanContext(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
): ProjectionPlanContext {
  return {
    snapshot,
    perspective,
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
    authoredStructure: { occurrences: new Map(), childOccurrences: new Map() },
    metanodes: {},
    templateStructure: { occurrences: new Map(), childOccurrences: new Map(), instances: [] },
    nodeOwners: {},
    nodeGraphStructure: {
      occurrences: new Map(),
      childOccurrences: new Map(),
      nodeOwners: {},
      workspaceSystemNodes: {},
      metanodes: {},
    },
    supertagRelations: emptySupertagRelations(),
    searchClauses: {},
    sharedDefaultViewDefinitions: {},
    fieldDefinitionConfigurations: {},
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
  const stripped = {
    nodes: new Map(Object.entries(previous.nodes).map(([id, node]) => [id, { ...node, content: [...node.content] }])),
    occurrences: new Map(Object.entries(previous.occurrences).map(([id, occurrence]) => [id, { ...occurrence }])),
  };
  const effectiveChildren = new Map(
    Object.entries(previous.childOccurrences).map(([id, childOccurrences]) => [id, [...childOccurrences]]),
  );
  const authored = authoredStructureWithoutProjectedTemplates(
    previous.templateNodeInstances,
    stripped.occurrences,
    effectiveChildren,
  );
  const { replayAllActive, requiresAllActive } = replayPolicy;
  return {
    snapshot,
    perspective: previous.perspective,
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
    metanodes: { ...previous.metanodes },
    templateStructure: {
      occurrences: stripped.occurrences,
      childOccurrences: effectiveChildren,
      instances: [...previous.templateNodeInstances],
    },
    nodeOwners: { ...previous.nodeOwners },
    nodeGraphStructure: {
      occurrences: stripped.occurrences,
      childOccurrences: effectiveChildren,
      nodeOwners: { ...previous.nodeOwners },
      workspaceSystemNodes: { ...previous.workspaceSystemNodes },
      metanodes: { ...previous.metanodes },
    },
    supertagRelations: {
      supertagApplications: previous.supertagApplications,
      supertagFields: previous.supertagFields,
      templateFields: previous.templateFields,
      supertagTemplateNodes: previous.supertagTemplateNodes,
      supertagExtensions: previous.supertagExtensions,
      supertagInstanceSupertags: previous.supertagInstanceSupertags,
      supertagExtensionConflicts: previous.supertagExtensionConflicts,
      effectiveFields: previous.effectiveFields,
      materializedFields: previous.materializedFields,
    },
    searchClauses: previous.searchClauses,
    sharedDefaultViewDefinitions: previous.sharedDefaultViewDefinitions,
    fieldDefinitionConfigurations: previous.fieldDefinitionConfigurations,
    conflictIssues: previous.conflictIssues,
    projection: null,
    previousPlanCache: previousCache,
  };
}

function emptySupertagRelations(): SupertagRelations {
  return {
    supertagApplications: {},
    supertagFields: {},
    templateFields: {},
    supertagTemplateNodes: {},
    supertagExtensions: {},
    supertagInstanceSupertags: {},
    supertagExtensionConflicts: {},
    effectiveFields: {},
    materializedFields: {},
  };
}
