import type { ContributionFact, Mutation } from "../fact/index.js";

export type NodeTypeDeclarationFact = ContributionFact &
  Readonly<{
    body: ContributionFact["body"] &
      Readonly<{ mutation: Extract<Mutation, { kind: "node-type-declare" }> }>;
  }>;

export function nodeTypeDeclarationsByNode(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly NodeTypeDeclarationFact[]> {
  const declarations = new Map<string, NodeTypeDeclarationFact[]>();
  for (const fact of active) {
    if (!isNodeTypeDeclaration(fact)) {
      continue;
    }
    const nodeId = fact.body.mutation.nodeId;
    const facts = declarations.get(nodeId) ?? [];
    facts.push(fact);
    declarations.set(nodeId, facts);
  }
  return declarations;
}

function isNodeTypeDeclaration(fact: ContributionFact): fact is NodeTypeDeclarationFact {
  return fact.body.mutation.kind === "node-type-declare";
}
