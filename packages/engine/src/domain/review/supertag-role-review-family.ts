import { defineReviewFamily } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import { addDefinitionLifecycleImpacts } from "./supertag-definition-impact.js";

export const supertagRoleReviewFamily = defineReviewFamily({
  key: "supertag-role",
  actionKinds: ["supertag-role-add", "supertag-role-remove", "supertag-role-restore"] as const,
  scopes: ({ action }) => [reviewScope("intrinsic-node-type", action.nodeId), associatedNodeScope(action.nodeId)],
  identify: ({ action }) => action.nodeId,
  effect: (_fact, nodeId, generation) => ({
    kind: "intrinsic-node-type" as const,
    identity: nodeId,
    origin: generation.origin.nodes[nodeId]?.intrinsicNodeType ?? null,
    review: generation.review.nodes[nodeId]?.intrinsicNodeType ?? null,
  }),
  changed: (effect) => effect.origin !== effect.review,
  diffKind: "lifecycle",
  effectIdentity: (nodeId) => `supertag-role/${nodeId}`,
  addImpacts(impacts, targets, generation) {
    for (const { action } of targets) {
      if (
        action.kind === "supertag-role-add" ||
        action.kind === "supertag-role-remove" ||
        action.kind === "supertag-role-restore"
      ) {
        addNodeReviewImpacts(impacts, action.nodeId, generation);
        addDefinitionLifecycleImpacts(impacts, action.nodeId, generation);
      }
    }
  },
});
