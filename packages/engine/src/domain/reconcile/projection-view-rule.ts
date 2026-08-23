import { projectionRule } from "./projection-rule.js";
import { projectSharedDefaultViewDefinitions } from "./shared-default-view-definitions.js";

export const viewProjectionRule = projectionRule({
  key: "view",
  dependencies: ["activation", "node", "node-graph", "supertag-relations"],
  factScope: "history",
  invalidatedBy: [
    "shared-default-view-add",
    "shared-default-view-remove",
    "shared-default-view-restore",
    "view-mode-set",
    "view-column-add",
    "view-column-remove",
    "view-column-move",
    "view-sort-add",
    "view-sort-configure",
    "view-sort-remove",
    "view-sort-restore",
    "view-group-add",
    "view-group-remove",
    "view-filter-add",
    "view-filter-remove",
    "view-filter-restore",
    "search-expression-add",
    "search-expression-configure",
    "search-expression-move",
    "search-expression-remove",
    "search-expression-restore",
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
