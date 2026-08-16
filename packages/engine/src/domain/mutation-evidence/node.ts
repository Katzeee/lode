import { canonicalJson, type Mutation, type NodeMutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { isPresentNodeOutsideTrash, nodeLocation } from "../reconcile/node-graph.js";
import { assertObservedDeletion } from "./lifecycle.js";
import type { MutationEvidenceContext, MutationEvidenceFamily } from "./policy.js";

const NODE_MUTATION_KINDS = [
  "node-create",
  "node-delete",
  "node-restore",
  "node-owner-set",
  "node-type-declare",
] as const satisfies readonly NodeMutation["kind"][];

export const nodeMutationEvidence = {
  key: "node",
  mutationKinds: NODE_MUTATION_KINDS,
  complete: completeNodeMutationEvidence,
  validate(mutation, context) {
    if (mutation.kind !== "node-owner-set") {
      return;
    }
    const { previous, available } = context.projections();
    const expected = completeNodeOwnerEvidence(mutation, previous, available);
    if (canonicalJson(expected.previousOwnerNodeId) !== canonicalJson(mutation.previousOwnerNodeId)) {
      throw new Error("Owner previous evidence does not match the observed projection");
    }
  },
} satisfies MutationEvidenceFamily<(typeof NODE_MUTATION_KINDS)[number]>;

function completeNodeMutationEvidence(mutation: NodeMutation, context: MutationEvidenceContext): NodeMutation {
  switch (mutation.kind) {
    case "node-create":
      return mutation;
    case "node-delete":
      assertNodeDeletionTarget(mutation, context.projections().available);
      return mutation;
    case "node-restore":
      assertObservedDeletion(context.snapshot, mutation.deletionFactId, "node-delete", mutation.nodeId);
      return mutation;
    case "node-owner-set": {
      const { previous, available } = context.projections();
      return completeNodeOwnerEvidence(mutation, previous, available);
    }
    case "node-type-declare":
      assertNodeTypeCompatible(mutation, context.projections().available);
      return mutation;
  }
}

export function completeNodeOwnerEvidence(
  mutation: Extract<Mutation, { kind: "node-owner-set" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "node-owner-set" }> {
  if (
    !isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId) ||
    !isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.ownerNodeId) ||
    !Object.values(available.occurrences).some(
      (occurrence) => occurrence.nodeId === mutation.nodeId && occurrence.parentNodeId === mutation.ownerNodeId,
    )
  ) {
    throw new Error("Owner target is absent from the observed projection");
  }
  assertOwnerAcyclic(mutation.nodeId, mutation.ownerNodeId, previous);
  const previousOwnerNodeId = previous.nodeOwners[mutation.nodeId];
  if (!previousOwnerNodeId) {
    throw new Error("Workspace Node ownership cannot change");
  }
  return { ...mutation, previousOwnerNodeId };
}

export function assertNodeTypeCompatible(
  mutation: Extract<Mutation, { kind: "node-type-declare" }>,
  available: ScopedProjection,
): void {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId)) {
    throw new Error(`Node type target is absent from the observed projection: ${mutation.nodeId}`);
  }
  const current = available.nodes[mutation.nodeId]?.nodeType ?? null;
  if (current !== null && current !== mutation.nodeType) {
    throw new Error("A Node cannot declare another type");
  }
}

export function assertNodeDeletionTarget(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  available: ScopedProjection,
): void {
  if (mutation.nodeId === available.workspaceSystemNodes.trash) {
    throw new Error("Workspace Trash cannot be deleted");
  }
  if (Object.values(available.metanodes).includes(mutation.nodeId)) {
    throw new Error("Metanode cannot be deleted independently of its host");
  }
  if (nodeLocation(available.identity.workspaceNodeId, available, mutation.nodeId) !== "active") {
    throw new Error(`Delete target Node does not exist: ${mutation.nodeId}`);
  }
}

function assertOwnerAcyclic(nodeId: string, ownerNodeId: string, projection: ScopedProjection): void {
  let cursor: string | null | undefined = ownerNodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === nodeId || seen.has(cursor)) {
      throw new Error("Node ownership would form a cycle");
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
}
