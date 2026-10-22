import { deriveSupport, activeSupertagRoles } from "../activation/index.js";
import {
  noCompensation,
  type CompensationCatalog,
  type CompensationRuleContext,
  type CompensationStep,
} from "./compensation-types.js";
import type { FactActionId } from "../fact/index.js";

export const SUPERTAG_ROLE_COMPENSATIONS = {
  "supertag-role-add": (context, target) => revokeRole(context, target.action.nodeId, target.id),
  "supertag-role-remove": ({ activeFacts }, { action }) =>
    activeSupertagRoles(activeFacts).some((role) => role.id === action.roleActionId)
      ? noCompensation()
      : {
          kind: "ready",
          actions: [{ kind: "supertag-role-restore", nodeId: action.nodeId, roleActionId: action.roleActionId }],
        },
  "supertag-role-restore": (context, { action }) => revokeRole(context, action.nodeId, action.roleActionId),
} satisfies Partial<CompensationCatalog>;

function revokeRole(context: CompensationRuleContext, nodeId: string, roleActionId: FactActionId): CompensationStep {
  const roles = activeSupertagRoles(context.activeFacts).filter((role) => role.action.nodeId === nodeId);
  if (!roles.some((role) => role.id === roleActionId)) {
    return noCompensation();
  }
  const independentRole = roles.some((role) => role.id !== roleActionId);
  if (!independentRole) {
    const work = new Set(
      context.activeFacts
        .filter(
          (fact) =>
            !context.targetIds.has(fact.id) &&
            fact.action.kind !== "supertag-role-add" &&
            fact.action.kind !== "supertag-role-remove" &&
            fact.action.kind !== "supertag-role-restore",
        )
        .map((fact) => fact.id),
    );
    if (
      [...deriveSupport(context.activeFacts)].some(([id, supports]) => work.has(id) && supports.includes(roleActionId))
    ) {
      return { kind: "stale", reason: "Later work still depends on this Supertag role" };
    }
  }
  return { kind: "ready", actions: [{ kind: "supertag-role-remove", nodeId, roleActionId }] };
}
