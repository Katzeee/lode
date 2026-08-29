import type { FactAction, FactSnapshot, ProjectionIdentity, ProjectionPerspective } from "../fact/index.js";
import { projectionIdentity } from "./projection-identity.js";
import type { Projection, ProjectionActivation, ProjectionSections, ProjectionVersions } from "./projection-types.js";
import type { AuthoredStructure, MutableNode } from "./projection-state.js";
import type { TemplateStructureProjection } from "./template-node-projection.js";
import type { SupertagRelations } from "./supertag-relations.js";
import type { NodeGraphStructure } from "./node-graph-structure.js";

export type ProjectionActivationArtifact = Readonly<{
  actions: readonly FactAction[];
  evidence: ProjectionActivation;
}>;

export type ProjectionPlanInputs = Readonly<{
  readonly snapshot: FactSnapshot;
  readonly perspective: ProjectionPerspective;
  readonly originActivation: ProjectionActivation | null;
  readonly identity: ProjectionIdentity;
  readonly workspaceNodeId: string;
}>;

export type ProjectionArtifacts = {
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
  projection: Projection;
};

export type ProjectionArtifactKey = keyof ProjectionArtifacts;

export type ProjectionPlanState = ProjectionPlanInputs & Partial<ProjectionArtifacts>;

export function createProjectionPlanState(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
  originActivation: ProjectionActivation | null = null,
): ProjectionPlanState {
  return {
    snapshot,
    perspective,
    identity: projectionIdentity(workspaceId, snapshot, versions),
    workspaceNodeId: workspaceId,
    originActivation,
  };
}
