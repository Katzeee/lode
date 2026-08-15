import { stableStringCompare, type ContributionFact, type NodeType } from "../fact/index.js";
import { nodeTypeDeclarationsByNode } from "./node-type-declarations.js";
import type { NodeStatus } from "./projection-types.js";

export function projectNodeStatuses(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  activeNodeIds: ReadonlySet<string>,
  deletionFactIds: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, NodeStatus>> {
  const nodeTypes = activeNodeTypes(active);
  const declaredNodeIds = declaredNodeTypeIds(active);
  const nodeIds = new Set([...knownNodeIds, ...activeNodeIds, ...deletionFactIds.keys(), ...declaredNodeIds]);
  return Object.fromEntries(
    [...nodeIds].sort(stableStringCompare).flatMap((nodeId) => {
      const state = activeNodeIds.has(nodeId)
        ? "active"
        : (deletionFactIds.get(nodeId)?.length ?? 0) > 0
          ? "deleted"
          : null;
      return state === null
        ? []
        : [
            [
              nodeId,
              {
                nodeId,
                nodeType: nodeTypes.get(nodeId) ?? null,
                state,
                deletionFactIds: [...(deletionFactIds.get(nodeId) ?? [])].sort(stableStringCompare),
              },
            ] as const,
          ];
    }),
  );
}

export function activeNodeTypes(active: readonly ContributionFact[]): ReadonlyMap<string, NodeType> {
  const declarations = declaredNodeTypes(active);
  return new Map(
    [...declarations].flatMap(([nodeId, nodeTypes]) => {
      const nodeType = [...nodeTypes][0];
      return nodeTypes.size === 1 && nodeType !== undefined ? [[nodeId, nodeType] as const] : [];
    }),
  );
}

function declaredNodeTypeIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(declaredNodeTypes(active).keys());
}

function declaredNodeTypes(active: readonly ContributionFact[]): ReadonlyMap<string, Set<NodeType>> {
  return new Map(
    [...nodeTypeDeclarationsByNode(active)].map(([nodeId, facts]) => [
      nodeId,
      new Set(facts.map((fact) => fact.body.mutation.nodeType)),
    ]),
  );
}
