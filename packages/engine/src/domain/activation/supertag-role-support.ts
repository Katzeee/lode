import { factObserves, type FactAction, type FactActionOf } from "../fact/index.js";

/** Role availability is shared by type-support selection and effective Node projection. */
export function activeSupertagRoles(actions: readonly FactAction[]): readonly FactActionOf<"supertag-role-add">[] {
  return actions.filter((fact): fact is FactActionOf<"supertag-role-add"> => {
    if (fact.action.kind !== "supertag-role-add") {
      return false;
    }
    const nodeId = fact.action.nodeId;
    const restorations = actions.filter(
      (candidate) =>
        candidate.action.kind === "supertag-role-restore" &&
        candidate.action.roleActionId === fact.id &&
        candidate.action.nodeId === nodeId,
    );
    return [fact, ...restorations].some(
      (source) =>
        !actions.some(
          (candidate) =>
            candidate.action.kind === "supertag-role-remove" &&
            candidate.action.roleActionId === fact.id &&
            candidate.action.nodeId === nodeId &&
            factObserves(candidate, source),
        ),
    );
  });
}
