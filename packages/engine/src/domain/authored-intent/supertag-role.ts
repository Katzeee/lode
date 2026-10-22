import { isActiveNode } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentFamily } from "./contract.js";

const kinds = ["supertag-role-add", "supertag-role-remove", "supertag-role-restore"] as const;
export const supertagRoleAuthoredIntent = {
  key: "supertag-role",
  actionKinds: kinds,
  assert(action, { available }) {
    if (action.kind !== "supertag-role-add") {
      throw new AuthoredIntentViolation("Supertag role compensation is only available through History");
    }
    if (
      !isActiveNode(available.identity.workspaceNodeId, available, action.nodeId) ||
      available.nodes[action.nodeId]?.intrinsicNodeType !== null
    ) {
      throw new AuthoredIntentViolation("Only an active ordinary Node can convert to a Supertag Definition");
    }
  },
} satisfies AuthoredIntentFamily<(typeof kinds)[number]>;
