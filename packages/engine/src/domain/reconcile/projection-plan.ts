import { activationProjectionStage } from "./activation-projection-stage.js";
import { authoredStructureProjectionStage } from "./authored-structure-projection-stage.js";
import { conflictProjectionStage } from "./conflict-projection-stage.js";
import { contentNodesProjectionStage } from "./content-nodes-projection-stage.js";
import { fieldDefinitionProjectionStage } from "./field-definition-projection-stage.js";
import { metanodesProjectionStage } from "./metanodes-projection-stage.js";
import { nodeGraphProjectionStage } from "./node-graph-projection-stage.js";
import { projectionAssemblyStage } from "./projection-assembly-stage.js";
import { compileProjectionPlan } from "./projection-plan-dag.js";
import type { ProjectionArtifactKey, ProjectionPlanState } from "./projection-plan-context.js";
import { projectionStages } from "./projection-stage.js";
import { searchProjectionStage } from "./search-projection-stage.js";
import { storedNodesProjectionStage } from "./stored-nodes-projection-stage.js";
import { supertagProjectionStage } from "./supertag-projection-stage.js";
import { templateProjectionStage } from "./template-projection-stage.js";
import { viewProjectionStage } from "./view-projection-stage.js";

const PROJECTION_STAGES = projectionStages([
  activationProjectionStage,
  storedNodesProjectionStage,
  metanodesProjectionStage,
  authoredStructureProjectionStage,
  contentNodesProjectionStage,
  nodeGraphProjectionStage,
  supertagProjectionStage,
  fieldDefinitionProjectionStage,
  searchProjectionStage,
  viewProjectionStage,
  conflictProjectionStage,
  templateProjectionStage,
  projectionAssemblyStage,
]);

export const PROJECTION_PLAN = compileProjectionPlan<ProjectionPlanState, ProjectionArtifactKey>(PROJECTION_STAGES);
