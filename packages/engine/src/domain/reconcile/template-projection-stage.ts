import { factActionsFromFacts } from "../fact/index.js";
import { projectionStage } from "./projection-stage.js";
import { supertagApplicationTargets } from "./supertag-relations.js";
import { projectTemplateStructure } from "./template-node-projection.js";

export const templateProjectionStage = projectionStage({
  key: "templateStructure",
  dependencies: ["activation", "storedNodes", "nodeGraphStructure", "supertagRelations"],
  project: (context) =>
    projectTemplateStructure(
      context.activation.actions,
      factActionsFromFacts(context.snapshot.facts),
      supertagApplicationTargets(context.supertagRelations.supertagApplications, new Set(context.storedNodes.keys())),
      context.supertagRelations.supertagTemplateNodes,
      context.supertagRelations.supertagExtensions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
    ),
});
