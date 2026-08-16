import type { ContributionFact, Mutation, NodeType } from "../fact/index.js";

export type NodeTypeDeclarationFact = ContributionFact &
  Readonly<{
    body: ContributionFact["body"] & Readonly<{ mutation: Extract<Mutation, { kind: "node-type-declare" }> }>;
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

export function activeNodeTypes(active: readonly ContributionFact[]): ReadonlyMap<string, NodeType> {
  return new Map(
    [...nodeTypeDeclarationsByNode(active)].flatMap(([nodeId, facts]) => {
      const nodeTypes = new Set(facts.map((fact) => fact.body.mutation.nodeType));
      const nodeType = [...nodeTypes][0];
      return nodeTypes.size === 1 && nodeType !== undefined ? [[nodeId, nodeType] as const] : [];
    }),
  );
}

function isNodeTypeDeclaration(fact: ContributionFact): fact is NodeTypeDeclarationFact {
  return fact.body.mutation.kind === "node-type-declare";
}
