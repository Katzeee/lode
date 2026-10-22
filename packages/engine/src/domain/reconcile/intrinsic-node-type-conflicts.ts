import { canonicalJson, compareCausalOrder, type FactAction } from "../fact/index.js";
import type { ConflictIssue } from "../conflict/index.js";
import { intrinsicNodeTypeContributions, type IntrinsicNodeTypeContribution } from "./intrinsic-node-types.js";

export function intrinsicNodeTypeConflicts(active: readonly FactAction[]): readonly ConflictIssue[] {
  return [...intrinsicNodeTypeContributions(active)].flatMap(([nodeId, facts]) => {
    const intrinsicNodeTypes = new Set(facts.map((item) => item.intrinsicNodeType));
    return intrinsicNodeTypes.size < 2 ? [] : [intrinsicNodeTypeConflict(nodeId, facts)];
  });
}

function intrinsicNodeTypeConflict(
  nodeId: string,
  facts: readonly IntrinsicNodeTypeContribution[],
): Extract<ConflictIssue, { kind: "intrinsic-node-type-conflict" }> {
  return {
    kind: "intrinsic-node-type-conflict",
    identity: canonicalJson(["intrinsic-node-type-conflict", nodeId]),
    nodeId,
    candidates: [...facts]
      .sort((left, right) => compareCausalOrder(left.fact, right.fact))
      .map(({ fact, intrinsicNodeType }) => ({
        factActionId: fact.id,
        intrinsicNodeType,
        actorId: fact.actorId,
        replicaId: fact.coordinate.dot.replicaId,
        observedFrontier: fact.coordinate.observed,
      })),
  };
}
