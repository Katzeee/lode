import { canonicalJson } from "./canonical.js";
import { isFactActionId } from "./identities.js";
import type { SearchClause } from "./search-expression-types.js";
import type { FactActionId, SequenceAnchor } from "./fact-value-types.js";
import type { IdentityContribution, IdentityRole, SemanticIdentity } from "./action-contribution-types.js";

export function identity(identityValue: SemanticIdentity, ...roles: readonly IdentityRole[]): IdentityContribution {
  return { kind: "identity", identity: identityValue, roles };
}

export function anchorIdentities(anchor: SequenceAnchor): readonly IdentityContribution[] {
  return [anchor.after, anchor.before].flatMap((occurrenceId) =>
    occurrenceId === null ? [] : [identity({ kind: "occurrence", occurrenceId }, "relate")],
  );
}

export function fieldDefinitionIdentities(
  nodeId: string,
  mode: "declare" | "require",
  owner = false,
): readonly IdentityContribution[] {
  const relationRoles: IdentityRole[] = ["relate"];
  if (owner) {
    relationRoles.push("contribution-owner");
  }
  return [
    identity({ kind: "field-definition", nodeId }, ...relationRoles),
    identity({ kind: "node", nodeId }, mode),
    identity({ kind: "intrinsic-node-type", nodeId, intrinsicNodeType: "field-definition" }, mode),
  ];
}

export function supertagIdentities(
  nodeId: string,
  instanceLookup: boolean,
  owner = false,
): readonly IdentityContribution[] {
  const relationRoles: IdentityRole[] = ["relate"];
  if (owner) {
    relationRoles.push("contribution-owner");
  }
  return [
    identity({ kind: "supertag", nodeId, instanceLookup }, ...relationRoles),
    identity({ kind: "node", nodeId }, "require"),
    identity({ kind: "intrinsic-node-type", nodeId, intrinsicNodeType: "supertag-definition" }, "require"),
  ];
}

export function searchClauseIdentities(clause: SearchClause): readonly IdentityContribution[] {
  if (clause.kind === "supertag") {
    return supertagIdentities(clause.supertagId, false);
  }
  if (clause.kind === "field-defined" || clause.kind === "field-value" || clause.kind === "date-compare") {
    return [
      identity({ kind: "node", nodeId: clause.fieldDefinitionId }, "relate", "require"),
      identity(
        {
          kind: "intrinsic-node-type",
          nodeId: clause.fieldDefinitionId,
          intrinsicNodeType: "field-definition",
        },
        "require",
      ),
      ...(clause.kind === "field-value" && clause.value.kind === "node"
        ? [identity({ kind: "node", nodeId: clause.value.nodeId }, "relate", "require")]
        : []),
    ];
  }
  if ((clause.kind === "descendant-of" || clause.kind === "child-of") && clause.target.kind === "node") {
    return [identity({ kind: "node", nodeId: clause.target.nodeId }, "relate", "require")];
  }
  return clause.kind === "links-to"
    ? [identity({ kind: "node", nodeId: clause.targetNodeId }, "relate", "require")]
    : [];
}

export function expressionHostIdentities(expressionHostId: string): readonly IdentityContribution[] {
  return [
    identity({ kind: "node", nodeId: expressionHostId }, "relate", "contribution-owner"),
    identity(
      isFactActionId(expressionHostId)
        ? { kind: "fact-action", factActionId: expressionHostId }
        : { kind: "node", nodeId: expressionHostId },
      "require",
    ),
  ];
}

export function atomProducer(atomId: string): FactActionId {
  return atomId.slice(0, atomId.lastIndexOf("#")) as FactActionId;
}

export function relationKey(...parts: readonly string[]): string {
  return canonicalJson(parts);
}
