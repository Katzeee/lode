import type { FactAction } from "../fact/index.js";
import { isPresentNodeOutsideTrash } from "./node-graph.js";
import { projectionRule } from "./projection-rule.js";
import { deriveSupertagRelations } from "./supertag-relations.js";

export const supertagProjectionRule = projectionRule({
  key: "supertag-relations",
  dependencies: ["activation", "node", "content", "node-graph"],
  factScope: "history",
  invalidatedBy: [
    "node-create",
    "supertag-application-add",
    "supertag-membership-remove",
    "supertag-extension-add",
    "supertag-extension-remove",
    "template-field-add",
    "template-field-remove",
    "template-field-restore",
    "template-field-visibility-set",
    "template-field-static-default-set",
    "field-definition-make-discoverable",
    "field-definition-return-to-template-field",
    "optional-field-contribution-add",
    "optional-field-contribution-remove",
    "field-materialize",
    "rich-text-splice",
  ],
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
        context.activation.allActive,
        context.workspaceNodeId,
        effectiveNodes,
        activeNodeIds,
        knownNodeIds(context.activation.allActive),
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
    active.flatMap((fact) => {
      const authoredAction = fact.action;
      return authoredAction.kind === "node-create"
        ? [authoredAction.nodeId]
        : authoredAction.kind === "workspace-bootstrap"
          ? [authoredAction.workspaceNodeId]
          : [];
    }),
  );
}
