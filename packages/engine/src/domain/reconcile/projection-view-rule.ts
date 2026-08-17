import { projectionRule } from "./projection-rule.js";
import { projectSharedDefaultViewDefinitions } from "./shared-default-view-definitions.js";

export const viewProjectionRule = projectionRule({
  key: "view",
  dependencies: ["activation", "node", "node-graph", "supertag-relations"],
  factScope: "history",
  invalidatedBy: [
    "shared-default-view-definition-attach",
    "shared-default-view-definition-detach",
    "shared-default-view-definition-mode-set",
    "shared-default-view-definition-sort-by-name-set",
    "shared-default-view-definition-options-set",
  ],
  evaluate: (context) => ({
    sharedDefaultViewDefinitions: projectSharedDefaultViewDefinitions(
      context.workspaceNodeId,
      context.activation.allActive,
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
