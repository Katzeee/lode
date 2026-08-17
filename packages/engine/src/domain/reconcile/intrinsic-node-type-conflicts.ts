import { canonicalJson, compareFacts, type ContributionFact } from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import {
  intrinsicNodeTypeDeclarationsByNode,
  type IntrinsicNodeTypeDeclarationFact,
} from "./intrinsic-node-type-declarations.js";

export function intrinsicNodeTypeConflicts(active: readonly ContributionFact[]): readonly ConflictIssue[] {
  return [...intrinsicNodeTypeDeclarationsByNode(active)].flatMap(([nodeId, facts]) => {
    const intrinsicNodeTypes = new Set(facts.map((fact) => fact.body.mutation.intrinsicNodeType));
    return intrinsicNodeTypes.size < 2 ? [] : [intrinsicNodeTypeConflict(nodeId, facts)];
  });
}

function intrinsicNodeTypeConflict(
  nodeId: string,
  facts: readonly IntrinsicNodeTypeDeclarationFact[],
): Extract<ConflictIssue, { kind: "intrinsic-node-type-conflict" }> {
  return {
    kind: "intrinsic-node-type-conflict",
    identity: canonicalJson(["intrinsic-node-type-conflict", nodeId]),
    nodeId,
    candidates: [...facts].sort(compareFacts).map((fact) => ({
      contributionId: fact.id,
      intrinsicNodeType: fact.body.mutation.intrinsicNodeType,
      actorId: fact.body.actorId,
      replicaId: fact.coordinate.dot.replicaId,
      observedFrontier: fact.coordinate.observed,
    })),
  };
}
