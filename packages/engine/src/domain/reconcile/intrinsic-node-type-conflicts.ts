import { canonicalJson, compareCausalOrder, type FactAction } from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import { typedNodeCreationsByNode, type TypedNodeCreationFact } from "./intrinsic-node-types.js";

export function intrinsicNodeTypeConflicts(active: readonly FactAction[]): readonly ConflictIssue[] {
  return [...typedNodeCreationsByNode(active)].flatMap(([nodeId, facts]) => {
    const intrinsicNodeTypes = new Set(facts.map((fact) => fact.action.intrinsicNodeType));
    return intrinsicNodeTypes.size < 2 ? [] : [intrinsicNodeTypeConflict(nodeId, facts)];
  });
}

function intrinsicNodeTypeConflict(
  nodeId: string,
  facts: readonly TypedNodeCreationFact[],
): Extract<ConflictIssue, { kind: "intrinsic-node-type-conflict" }> {
  return {
    kind: "intrinsic-node-type-conflict",
    identity: canonicalJson(["intrinsic-node-type-conflict", nodeId]),
    nodeId,
    candidates: [...facts].sort(compareCausalOrder).map((fact) => ({
      factActionId: fact.id,
      intrinsicNodeType: fact.action.intrinsicNodeType,
      actorId: fact.actorId,
      replicaId: fact.coordinate.dot.replicaId,
      observedFrontier: fact.coordinate.observed,
    })),
  };
}
