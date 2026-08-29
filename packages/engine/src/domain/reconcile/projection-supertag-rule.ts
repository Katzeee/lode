import { actionIdentityProducers, type FactAction } from "../fact/index.js";
import { isPresentNodeOutsideTrash } from "./node-graph.js";
import { projectionRule } from "./projection-rule.js";
import { deriveSupertagRelations } from "./supertag-relations.js";

export const supertagProjectionRule = projectionRule({
  key: "supertag-relations",
  dependencies: ["activation", "node", "content", "node-graph"],
  evaluate(context) {
    const effectiveNodes = Object.fromEntries(context.contentNodes);
    const activeNodeIds = new Set(
      [...context.storedNodes.keys()].filter((nodeId) =>
        isPresentNodeOutsideTrash(
          context.workspaceNodeId,
          {
            nodes: effectiveNodes,
            nodeOwners: context.nodeGraphStructure.nodeOwners,
            workspaceSystemNodes: context.nodeGraphStructure.workspaceSystemNodes,
          },
          nodeId,
        ),
      ),
    );
    return {
      supertagRelations: deriveSupertagRelations(
        context.activation.actions,
        context.workspaceNodeId,
        effectiveNodes,
        activeNodeIds,
        knownNodeIds(context.activation.actions),
        context.nodeGraphStructure.occurrences,
        context.nodeGraphStructure.childOccurrences,
        context.nodeGraphStructure.metanodes,
        context.nodeGraphStructure.nodeOwners,
      ),
    };
  },
});

function knownNodeIds(active: readonly FactAction[]): ReadonlySet<string> {
  return new Set(
    active.flatMap((fact) =>
      actionIdentityProducers(fact.action).flatMap((identity) => (identity.kind === "node" ? [identity.nodeId] : [])),
    ),
  );
}
