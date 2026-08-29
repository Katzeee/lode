import type { FactAction, FactSnapshot, ProjectionIdentity, ProjectionPerspective } from "../fact/index.js";
import { projectionIdentity } from "./projection-identity.js";
import type { Projection, ProjectionActivation, ProjectionSections, ProjectionVersions } from "./projection-types.js";
import type { AuthoredStructure, MutableNode } from "./projection-state.js";
import type { TemplateStructureProjection } from "./template-node-projection.js";
import type { SupertagRelations } from "./supertag-relations.js";
import type { NodeGraphStructure } from "./node-graph-structure.js";

type ProjectionActivationArtifact = Readonly<{
  actions: readonly FactAction[];
  evidence: ProjectionActivation;
}>;

export type ProjectionPlanContext = {
  readonly snapshot: FactSnapshot;
  readonly perspective: ProjectionPerspective;
  readonly originActivation: ProjectionActivation | null;
  readonly identity: ProjectionIdentity;
  readonly workspaceNodeId: string;
  activation: ProjectionActivationArtifact;
  storedNodes: Map<string, MutableNode>;
  contentNodes: Map<string, MutableNode>;
  authoredStructure: AuthoredStructure;
  metanodes: ProjectionSections["metanodes"];
  templateStructure: TemplateStructureProjection;
  nodeGraphStructure: NodeGraphStructure;
  supertagRelations: SupertagRelations;
  searchExpressions: ProjectionSections["searchExpressions"];
  sharedDefaultViewDefinitions: ProjectionSections["sharedDefaultViewDefinitions"];
  fieldDefinitionConfigurations: ProjectionSections["fieldDefinitionConfigurations"];
  conflictIssues: ProjectionSections["conflictIssues"];
  projection: Projection | null;
};

export function createProjectionPlanContext(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
  originActivation: ProjectionActivation | null = null,
): ProjectionPlanContext {
  return {
    snapshot,
    perspective,
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    activation: {
      actions: [],
      evidence: { activeActionIds: [], supportByAction: {} },
    },
    storedNodes: new Map(),
    contentNodes: new Map(),
    authoredStructure: { occurrences: new Map(), childOccurrences: new Map() },
    metanodes: {},
    templateStructure: { occurrences: new Map(), childOccurrences: new Map(), instances: [] },
    nodeGraphStructure: {
      occurrences: new Map(),
      childOccurrences: new Map(),
      nodeOwners: {},
      workspaceSystemNodes: {},
      metanodes: {},
    },
    supertagRelations: emptySupertagRelations(),
    searchExpressions: {},
    sharedDefaultViewDefinitions: {},
    fieldDefinitionConfigurations: {},
    conflictIssues: {},
    projection: null,
    originActivation,
  };
}

function emptySupertagRelations(): SupertagRelations {
  return {
    supertagApplications: {},
    supertagTemplateNodes: {},
    templateFields: {},
    optionalFieldContributions: {},
    supertagExtensions: {},
    supertagInstanceSupertags: {},
    supertagExtensionConflicts: {},
    materializedFields: {},
    effectiveFields: {},
    optionalFieldSuggestions: {},
  };
}
