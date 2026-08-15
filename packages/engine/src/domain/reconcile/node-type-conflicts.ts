import { canonicalJson, compareFacts, type ContributionFact } from "../fact/index.js";
import type { ConflictIssue } from "../conflict/types.js";
import { nodeTypeDeclarationsByNode, type NodeTypeDeclarationFact } from "./node-type-declarations.js";

export function nodeTypeConflicts(active: readonly ContributionFact[]): readonly ConflictIssue[] {
  return [...nodeTypeDeclarationsByNode(active)].flatMap(([nodeId, facts]) => {
    const nodeTypes = new Set(facts.map((fact) => fact.body.mutation.nodeType));
    return nodeTypes.size < 2 ? [] : [nodeTypeConflict(nodeId, facts)];
  });
}

function nodeTypeConflict(
  nodeId: string,
  facts: readonly NodeTypeDeclarationFact[],
): Extract<ConflictIssue, { kind: "node-type-conflict" }> {
  return {
    kind: "node-type-conflict",
    identity: canonicalJson(["node-type-conflict", nodeId]),
    nodeId,
    candidates: [...facts].sort(compareFacts).map((fact) => ({
      contributionId: fact.id,
      nodeType: fact.body.mutation.nodeType,
      actorId: fact.body.actorId,
      replicaId: fact.coordinate.dot.replicaId,
      observedFrontier: fact.coordinate.observed,
    })),
  };
}
