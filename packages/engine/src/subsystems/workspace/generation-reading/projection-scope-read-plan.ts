import { emptyGenerationReadScope } from "./read-scope.js";
import type { GenerationReadPlan } from "./read-plan.js";

export function planProjectionScopeGenerationRead(
  nodeIds: readonly string[],
  readsOwnerGraph: boolean,
  readsOwnedDescendants: boolean,
): GenerationReadPlan {
  return {
    actions: [],
    readsOwnerGraph,
    ownedRootNodeIds: readsOwnedDescendants ? nodeIds : [],
    createScope() {
      const scope = emptyGenerationReadScope();
      nodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
      return scope;
    },
  };
}
