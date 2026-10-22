import { actionIdentityProducers } from "./action-semantics.js";
import { templateFieldProjectionIdentity } from "./template-field-identity.js";
import type { FactAction } from "./types.js";
import type { IntrinsicNodeType } from "./intrinsic-node-type-types.js";

/** Every structural producer participates in the same exclusive type axis. */
export function intrinsicNodeTypeDeclarations(
  fact: FactAction,
): readonly Readonly<{ nodeId: string; intrinsicNodeType: IntrinsicNodeType }>[] {
  const declarations = actionIdentityProducers(fact.action).flatMap((identity) =>
    identity.kind === "intrinsic-node-type"
      ? [{ nodeId: identity.nodeId, intrinsicNodeType: identity.intrinsicNodeType }]
      : [],
  );
  if (fact.action.kind === "template-field-add") {
    declarations.push({
      nodeId: templateFieldProjectionIdentity(fact.id).templateFieldNodeId,
      intrinsicNodeType: "field",
    });
  }
  return declarations;
}
