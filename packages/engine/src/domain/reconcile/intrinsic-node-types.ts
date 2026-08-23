import type { FactAction, AuthoredAction, IntrinsicNodeType } from "../fact/index.js";

export type TypedNodeCreationFact = FactAction &
  Readonly<{
    action: Extract<AuthoredAction, { kind: "node-create" }> & Readonly<{ intrinsicNodeType: IntrinsicNodeType }>;
  }>;

export function typedNodeCreationsByNode(
  active: readonly FactAction[],
): ReadonlyMap<string, readonly TypedNodeCreationFact[]> {
  const creations = new Map<string, TypedNodeCreationFact[]>();
  for (const fact of active) {
    if (!isTypedNodeCreation(fact)) {
      continue;
    }
    const nodeId = fact.action.nodeId;
    const facts = creations.get(nodeId) ?? [];
    facts.push(fact);
    creations.set(nodeId, facts);
  }
  return creations;
}

export function activeIntrinsicNodeTypes(active: readonly FactAction[]): ReadonlyMap<string, IntrinsicNodeType> {
  return new Map(
    [...typedNodeCreationsByNode(active)].flatMap(([nodeId, facts]) => {
      const intrinsicNodeTypes = new Set(facts.map((fact) => fact.action.intrinsicNodeType));
      const intrinsicNodeType = [...intrinsicNodeTypes][0];
      return intrinsicNodeTypes.size === 1 && intrinsicNodeType !== undefined
        ? [[nodeId, intrinsicNodeType] as const]
        : [];
    }),
  );
}

function isTypedNodeCreation(fact: FactAction): fact is TypedNodeCreationFact {
  return fact.action.kind === "node-create" && fact.action.intrinsicNodeType !== undefined;
}
