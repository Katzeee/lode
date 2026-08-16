import { projectionRule } from "./projection-rule.js";
import { projectSharedDefaultViewDefinitions } from "./shared-default-view-definitions.js";

export const viewProjectionRule = projectionRule({
  key: "view",
  dependencies: ["activation", "node", "node-graph"],
  factScope: "history",
  invalidatedBy: ["shared-default-view-definition-attach", "shared-default-view-definition-mode-set"],
  evaluate: (context) => ({
    sharedDefaultViewDefinitions: projectSharedDefaultViewDefinitions(
      context.workspaceNodeId,
      context.activation.allActive,
      context.storedNodes,
      context.nodeGraphStructure.occurrences,
      context.nodeGraphStructure.nodeOwners,
      context.nodeGraphStructure.metanodes,
      context.nodeGraphStructure.workspaceSystemNodes,
    ),
  }),
});
