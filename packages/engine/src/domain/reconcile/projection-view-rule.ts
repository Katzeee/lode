import { projectionRule } from "./projection-rule.js";
import { projectSharedDefaultViewDefinitions } from "./shared-default-view-definitions.js";

export const viewProjectionRule = projectionRule({
  key: "view",
  dependencies: ["activation", "node", "node-graph", "supertag-relations"],
  evaluate: (context) => ({
    sharedDefaultViewDefinitions: projectSharedDefaultViewDefinitions(
      context.workspaceNodeId,
      context.activation.actions,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.childOccurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.metanodes,
      context.nodeGraphStructure.workspaceSystemNodes,
      context.supertagRelations.materializedFields,
    ),
  }),
});
