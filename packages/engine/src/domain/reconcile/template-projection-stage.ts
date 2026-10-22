import { isActiveNode } from "./node-graph.js";
import { projectionStage } from "./projection-stage.js";
import { supertagApplicationTargets } from "./supertag-relations.js";
import { projectTemplateStructure } from "./template-node-projection.js";

export const templateProjectionStage = projectionStage({
  key: "templateStructure",
  dependencies: ["activation", "storedNodes", "nodeGraphStructure", "supertagRelations"],
  project: (context) =>
    projectTemplateStructure(
      context.activation.actions,
      supertagApplicationTargets(context.supertagRelations.supertagApplications, new Set(context.storedNodes.keys())),
      context.supertagRelations.supertagTemplateNodes,
      context.supertagRelations.supertagExtensions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      new Set(
        [...context.storedNodes.keys()].filter((id) =>
          isActiveNode(
            context.workspaceNodeId,
            {
              nodes: Object.fromEntries(context.storedNodes),
              nodeOwners: context.nodeGraphStructure.nodeOwners,
              workspaceSystemNodes: context.nodeGraphStructure.workspaceSystemNodes,
            },
            id,
          ),
        ),
      ),
    ),
});
