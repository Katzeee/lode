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
  "intrinsic-node-type-declare",
] as const satisfies readonly NodeMutation["kind"][];

export const nodeMutationEvidence = {
  key: "node",
  mutationKinds: NODE_MUTATION_KINDS,
  complete: completeNodeMutationEvidence,
  validate(mutation, context) {
    if (mutation.kind !== "node-owner-set") {
      return;
    }
    if (mutation.previousOwnerNodeId === null) {
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
      if (mutation.previousOwnerNodeId === null) {
        return mutation;
      }
      const { previous, available } = context.projections();
      return completeNodeOwnerEvidence(mutation, previous, available);
    }
    case "intrinsic-node-type-declare":
      assertIntrinsicNodeTypeCompatible(mutation, context.projections().available);
      return mutation;
  }
}

export function completeNodeOwnerEvidence(
  mutation: Extract<Mutation, { kind: "node-owner-set" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "node-owner-set" }> {
  const previousOwnerNodeId = previous.nodeOwners[mutation.nodeId];
  if (available.nodes[mutation.nodeId] === undefined) {
    throw new Error("Owner subject is absent from the observed projection");
  }
  if (
    mutation.ownerNodeId !== null &&
    !isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.ownerNodeId)
  ) {
    throw new Error("Owner target is absent from the observed projection");
  }
  if (mutation.ownerNodeId !== null) {
    assertOwnerAcyclic(mutation.nodeId, mutation.ownerNodeId, previous);
  }
  if (previousOwnerNodeId === undefined) {
    throw new Error("Workspace Node ownership cannot change");
  }
  return { ...mutation, previousOwnerNodeId };
}

export function assertIntrinsicNodeTypeCompatible(
  mutation: Extract<Mutation, { kind: "intrinsic-node-type-declare" }>,
  available: ScopedProjection,
): void {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId)) {
    throw new Error(`Intrinsic Node Type target is absent from the observed projection: ${mutation.nodeId}`);
  }
  const current = available.nodes[mutation.nodeId]?.intrinsicNodeType ?? null;
  if (current !== null && current !== mutation.intrinsicNodeType) {
    throw new Error("A Node cannot declare another type");
  }
}

export function assertNodeDeletionTarget(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  available: ScopedProjection,
): void {
  if (belongsToSystemRole(mutation.nodeId, available)) {
    throw new Error("Workspace System Node cannot be deleted");
  }
  if (Object.values(available.metanodes).includes(mutation.nodeId)) {
    throw new Error("Metanode cannot be deleted independently of its host");
  }
  if (nodeLocation(available.identity.workspaceNodeId, available, mutation.nodeId) !== "active") {
    throw new Error(`Delete target Node does not exist: ${mutation.nodeId}`);
  }
}

function belongsToSystemRole(nodeId: string, projection: ScopedProjection): boolean {
  const protectedRoots = new Set(Object.values(projection.workspaceSystemNodes));
  let cursor: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    if (protectedRoots.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
  return false;
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
