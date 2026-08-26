import {
  actionIdentityRequirements,
  type AuthoredAction,
  type IntrinsicNodeType,
  type SemanticIdentity,
} from "../fact/index.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export function addIdentityRequirementSupport(
  support: Set<string>,
  action: AuthoredAction,
  context: IdentitySupportContext,
): void {
  for (const requirement of actionIdentityRequirements(action)) {
    addIdentitySupport(support, requirement, context);
  }
}

function addIdentitySupport(support: Set<string>, identity: SemanticIdentity, context: IdentitySupportContext): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable } = context;
  switch (identity.kind) {
    case "node":
    case "node-children":
    case "supertag":
    case "field-definition":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, identity.nodeId, viable));
      return;
    case "occurrence":
      addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, identity.occurrenceId, viable));
      return;
    case "fact-action":
      support.add(identity.factActionId);
      return;
    case "inline-reference":
      addIfPresent(support, effectiveCandidate(context.inlineReferenceSupport, identity.inlineReferenceId, viable));
      return;
    case "inline-alias":
      addIfPresent(
        support,
        effectiveCandidate(context.inlineAliasSupport, `${identity.inlineReferenceId}/${identity.aliasNodeId}`, viable),
      );
      return;
    case "intrinsic-node-type":
      addIfPresent(
        support,
        effectiveCandidate(
          context.intrinsicNodeTypeSupport,
          intrinsicNodeTypeSupportKey(identity.nodeId, identity.intrinsicNodeType),
          viable,
        ),
      );
  }
}

export type IdentitySupportContext = Readonly<{
  nodeExistenceSupport: Map<string, string[]>;
  occurrenceExistenceSupport: Map<string, string[]>;
  viable: Set<string>;
  intrinsicNodeTypeSupport: Map<string, string[]>;
  inlineReferenceSupport: Map<string, string[]>;
  inlineAliasSupport: Map<string, string[]>;
}>;

export function intrinsicNodeTypeSupportKey(nodeId: string, intrinsicNodeType: IntrinsicNodeType): string {
  return JSON.stringify([nodeId, intrinsicNodeType]);
}
