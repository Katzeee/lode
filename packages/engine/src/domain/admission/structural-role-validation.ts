import {
  canonicalJson,
  workspaceGenesisMutations,
  type FactSnapshot,
  type FactTransaction,
  type Mutation,
} from "../fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration } from "../reconcile/index.js";
import { collectOwnedRoles, type OwnedRoles } from "./structural-role-ownership.js";
import { validateCreatedSemanticRelations } from "./structural-role-postconditions.js";
import { collectProtectedRoles, type ProtectedRoles } from "./structural-role-protection.js";

export function validateStructuralRoleChanges(
  transaction: FactTransaction,
  before: FactSnapshot,
  after: FactSnapshot,
): void {
  const workspaceId = transaction.facts[0]?.workspaceId ?? "";
  if (isWorkspaceGenesisTransaction(transaction, workspaceId)) {
    return;
  }
  const beforeGeneration = rebuildGeneration(workspaceId, before, CURRENT_PROJECTION_VERSIONS);
  const afterGeneration = rebuildGeneration(workspaceId, after, CURRENT_PROJECTION_VERSIONS);
  const projections = [
    beforeGeneration.origin,
    beforeGeneration.review,
    afterGeneration.origin,
    afterGeneration.review,
  ];
  const protectedRoles = collectProtectedRoles([beforeGeneration.origin, beforeGeneration.review], before);
  const ownedRoles = collectOwnedRoles(transaction, projections);

  for (const fact of transaction.facts) {
    if (fact.body.kind === "contribution") {
      validateMutationRoleAccess(fact.body.mutation, protectedRoles, ownedRoles);
    }
  }
  validateCreatedSemanticRelations(
    transaction,
    beforeGeneration.origin,
    beforeGeneration.review,
    afterGeneration.origin,
    afterGeneration.review,
  );
}

function isWorkspaceGenesisTransaction(transaction: FactTransaction, workspaceId: string): boolean {
  const mutations = transaction.facts.flatMap((fact) =>
    fact.body.kind === "contribution" ? [fact.body.mutation] : [],
  );
  return canonicalJson(mutations) === canonicalJson(workspaceGenesisMutations(workspaceId));
}

function validateMutationRoleAccess(mutation: Mutation, protectedRoles: ProtectedRoles, owned: OwnedRoles): void {
  const reject = createRoleRejector(protectedRoles, owned);
  if (
    mutation.kind === "node-create" ||
    mutation.kind === "node-delete" ||
    mutation.kind === "node-restore" ||
    mutation.kind === "text-splice" ||
    mutation.kind === "text-mark"
  ) {
    reject.node(mutation.nodeId);
  } else if (mutation.kind === "node-owner-set") {
    reject.owner(mutation.nodeId);
  } else if (mutation.kind === "intrinsic-node-type-declare") {
    reject.intrinsicNodeType(mutation.nodeId);
  } else if (mutation.kind === "occurrence-create") {
    reject.occurrence(mutation.occurrenceId);
    reject.referencedNode(mutation.nodeId);
    reject.parent(mutation.parentNodeId);
  } else if (mutation.kind === "occurrence-delete") {
    reject.occurrence(mutation.occurrenceId);
  } else if (mutation.kind === "occurrence-restore" || mutation.kind === "occurrence-move") {
    reject.occurrence(mutation.occurrenceId);
    reject.parent(mutation.parentNodeId);
  } else if (mutation.kind === "metanode-attach") {
    reject.node(mutation.hostNodeId);
    reject.node(mutation.metanodeId);
  } else if (mutation.kind === "inline-reference-create") {
    reject.node(mutation.hostNodeId);
  } else if (mutation.kind === "inline-reference-delete") {
    reject.inlineReference(mutation.inlineReferenceId);
  } else if (mutation.kind === "inline-reference-alias-attach" || mutation.kind === "inline-reference-alias-detach") {
    reject.inlineReference(mutation.inlineReferenceId);
    reject.node(mutation.aliasNodeId);
  }
}

type RoleRejector = Readonly<{
  node: (nodeId: string) => void;
  owner: (nodeId: string) => void;
  referencedNode: (nodeId: string) => void;
  intrinsicNodeType: (nodeId: string) => void;
  occurrence: (occurrenceId: string) => void;
  parent: (parentNodeId: string) => void;
  inlineReference: (inlineReferenceId: string) => void;
}>;

function createRoleRejector(protectedRoles: ProtectedRoles, owned: OwnedRoles): RoleRejector {
  return {
    node(nodeId) {
      if (protectedRoles.nodes.has(nodeId) && !owned.nodes.has(nodeId)) {
        throw new Error(`Structural role requires a typed mutation: Node ${nodeId}`);
      }
    },
    owner(nodeId) {
      if (protectedRoles.owners.has(nodeId) && !owned.nodes.has(nodeId) && !owned.owners.has(nodeId)) {
        throw new Error(`Structural role requires a typed mutation: Owner ${nodeId}`);
      }
    },
    referencedNode(nodeId) {
      if (protectedRoles.nodes.has(nodeId) && !owned.nodes.has(nodeId) && !owned.references.has(nodeId)) {
        throw new Error(`Structural role requires a typed mutation: Node ${nodeId}`);
      }
    },
    intrinsicNodeType(nodeId) {
      if (
        (protectedRoles.nodes.has(nodeId) || protectedRoles.intrinsicNodeTypes.has(nodeId)) &&
        !owned.nodes.has(nodeId)
      ) {
        throw new Error(`Structural role requires a typed mutation: Intrinsic Node Type ${nodeId}`);
      }
    },
    occurrence(occurrenceId) {
      if (protectedRoles.occurrences.has(occurrenceId) && !owned.occurrences.has(occurrenceId)) {
        throw new Error(`Structural role requires a typed mutation: Occurrence ${occurrenceId}`);
      }
    },
    parent(parentNodeId) {
      if (protectedRoles.closedParents.has(parentNodeId) && !owned.parents.has(parentNodeId)) {
        throw new Error(`Structural role requires a typed mutation: Tuple ${parentNodeId}`);
      }
    },
    inlineReference(inlineReferenceId) {
      if (protectedRoles.inlineReferences.has(inlineReferenceId) && !owned.inlineReferences.has(inlineReferenceId)) {
        throw new Error(`Structural role requires a typed mutation: Inline Reference ${inlineReferenceId}`);
      }
    },
  };
}
