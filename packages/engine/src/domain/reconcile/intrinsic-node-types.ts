import { intrinsicNodeTypeDeclarations, type FactAction, type IntrinsicNodeType } from "../fact/index.js";
import { activeSupertagRoles } from "../activation/index.js";

export type IntrinsicNodeTypeContribution = Readonly<{ fact: FactAction; intrinsicNodeType: IntrinsicNodeType }>;

export function intrinsicNodeTypeContributions(
  active: readonly FactAction[],
): ReadonlyMap<string, readonly IntrinsicNodeTypeContribution[]> {
  const contributions = new Map<string, IntrinsicNodeTypeContribution[]>();
  function add(nodeId: string, contribution: IntrinsicNodeTypeContribution) {
    const values = contributions.get(nodeId) ?? [];
    values.push(contribution);
    contributions.set(nodeId, values);
  }
  for (const fact of active) {
    if (fact.action.kind === "supertag-role-add") {
      continue;
    }
    for (const declaration of intrinsicNodeTypeDeclarations(fact)) {
      add(declaration.nodeId, { fact, intrinsicNodeType: declaration.intrinsicNodeType });
    }
  }
  for (const addition of activeSupertagRoles(active)) {
    add(addition.action.nodeId, { fact: addition, intrinsicNodeType: "supertag-definition" });
  }
  return contributions;
}

export function activeIntrinsicNodeTypes(active: readonly FactAction[]): ReadonlyMap<string, IntrinsicNodeType | null> {
  return new Map(
    [...intrinsicNodeTypeContributions(active)].flatMap(([nodeId, facts]) => {
      const types = new Set(facts.map((item) => item.intrinsicNodeType));
      const type = [...types][0];
      return [[nodeId, types.size === 1 && type !== undefined ? type : null] as const];
    }),
  );
}
