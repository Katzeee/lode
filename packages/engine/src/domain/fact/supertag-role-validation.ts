import { factActionsFromFacts } from "./fact-actions.js";
import { factObserves } from "./frontier.js";
import { intrinsicNodeTypeDeclarations } from "./intrinsic-node-type-declarations.js";
import { actionIdentityProducers } from "./action-semantics.js";
import type { FactSnapshot } from "./types.js";

/** Conversion claims must have an ordinary subject in their causal past. */
export function validateSupertagRoleFacts(snapshot: FactSnapshot): void {
  const actions = factActionsFromFacts(snapshot.facts);
  const byId = new Map(actions.map((fact) => [fact.id, fact]));
  const declarations = actions.flatMap((fact) =>
    intrinsicNodeTypeDeclarations(fact).map((value) => ({ fact, ...value })),
  );
  for (const fact of actions) {
    const action = fact.action;
    if (action.kind === "supertag-role-add") {
      const ordinarySubject = actions.some(
        (source) =>
          factObserves(fact, source) &&
          (actionIdentityProducers(source.action).some(
            (identity) => identity.kind === "node" && identity.nodeId === action.nodeId,
          ) ||
            intrinsicNodeTypeDeclarations(source).some((declaration) => declaration.nodeId === action.nodeId)),
      );
      if (
        !ordinarySubject ||
        declarations.some(
          (declaration) =>
            declaration.nodeId === action.nodeId &&
            declaration.intrinsicNodeType !== "supertag-definition" &&
            factObserves(fact, declaration.fact),
        )
      ) {
        throw new Error(
          "Supertag conversion Fact requires an observed ordinary Node without an incompatible structural type",
        );
      }
    } else if (action.kind === "supertag-role-remove" || action.kind === "supertag-role-restore") {
      const source = byId.get(action.roleActionId);
      if (
        source?.action.kind !== "supertag-role-add" ||
        source.action.nodeId !== action.nodeId ||
        !factObserves(fact, source)
      ) {
        throw new Error("Supertag role compensation Fact must observe the matching Node role contribution");
      }
    }
  }
}
