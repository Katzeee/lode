import type { ContributionFact, Mutation, IntrinsicNodeType } from "../fact/index.js";

export type IntrinsicNodeTypeDeclarationFact = ContributionFact &
  Readonly<{
    body: ContributionFact["body"] & Readonly<{ mutation: Extract<Mutation, { kind: "intrinsic-node-type-declare" }> }>;
  }>;

export function intrinsicNodeTypeDeclarationsByNode(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly IntrinsicNodeTypeDeclarationFact[]> {
  const declarations = new Map<string, IntrinsicNodeTypeDeclarationFact[]>();
  for (const fact of active) {
    if (!isIntrinsicNodeTypeDeclaration(fact)) {
      continue;
    }
    const nodeId = fact.body.mutation.nodeId;
    const facts = declarations.get(nodeId) ?? [];
    facts.push(fact);
    declarations.set(nodeId, facts);
  }
  return declarations;
}

export function activeIntrinsicNodeTypes(active: readonly ContributionFact[]): ReadonlyMap<string, IntrinsicNodeType> {
  return new Map(
    [...intrinsicNodeTypeDeclarationsByNode(active)].flatMap(([nodeId, facts]) => {
      const intrinsicNodeTypes = new Set(facts.map((fact) => fact.body.mutation.intrinsicNodeType));
      const intrinsicNodeType = [...intrinsicNodeTypes][0];
      return intrinsicNodeTypes.size === 1 && intrinsicNodeType !== undefined
        ? [[nodeId, intrinsicNodeType] as const]
        : [];
    }),
  );
}

function isIntrinsicNodeTypeDeclaration(fact: ContributionFact): fact is IntrinsicNodeTypeDeclarationFact {
  return fact.body.mutation.kind === "intrinsic-node-type-declare";
}
