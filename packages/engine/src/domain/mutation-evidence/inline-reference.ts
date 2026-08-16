import type { InlineReferenceMutation } from "../fact/index.js";
import { locateInlineReference } from "../reconcile/index.js";
import type { MutationEvidenceFamily } from "./policy.js";

const INLINE_REFERENCE_MUTATION_KINDS = [
  "inline-reference-create",
  "inline-reference-delete",
  "inline-reference-alias-attach",
  "inline-reference-alias-detach",
] as const satisfies readonly InlineReferenceMutation["kind"][];

export const inlineReferenceMutationEvidence = {
  key: "inline-reference",
  mutationKinds: INLINE_REFERENCE_MUTATION_KINDS,
  complete(mutation, context) {
    if (mutation.kind !== "inline-reference-delete") {
      return mutation;
    }
    const location = locateInlineReference(context.projections().available.nodes, mutation.inlineReferenceId);
    return location === null
      ? mutation
      : {
          ...mutation,
          previousHostNodeId: location.hostNodeId,
          previousTargetNodeId: location.reference.targetNodeId,
          previousAnchor: location.anchor,
        };
  },
  validate(mutation, context) {
    const available = context.projections().available;
    const location = locateInlineReference(available.nodes, mutation.inlineReferenceId);
    if (mutation.kind === "inline-reference-create") {
      if (available.nodes[mutation.hostNodeId] === undefined || available.nodes[mutation.targetNodeId] === undefined) {
        throw new Error("Inline Reference host and target must exist in the current Projection");
      }
      if (location !== null) {
        throw new Error("Inline Reference identity already exists");
      }
      return;
    }
    if (location === null) {
      throw new Error("Inline Reference is absent from the current Projection");
    }
    if (mutation.kind === "inline-reference-delete") {
      if (
        mutation.previousHostNodeId !== location.hostNodeId ||
        mutation.previousTargetNodeId !== location.reference.targetNodeId
      ) {
        throw new Error("Inline Reference deletion evidence is stale");
      }
      return;
    }
    if (available.nodes[mutation.aliasNodeId] === undefined) {
      throw new Error("Inline Alias Node is absent from the current Projection");
    }
    const rootNodeId = available.metanodes[location.hostNodeId];
    if (rootNodeId === undefined || !isOwnedWithin(available.nodeOwners, mutation.aliasNodeId, rootNodeId)) {
      throw new Error("Inline Alias Node must belong to the host Configuration Graph");
    }
    if (mutation.kind === "inline-reference-alias-attach" && location.reference.aliasNodeId !== null) {
      throw new Error("Inline Reference already has an Alias");
    }
    if (mutation.kind === "inline-reference-alias-detach" && location.reference.aliasNodeId !== mutation.aliasNodeId) {
      throw new Error("Inline Reference Alias attachment is stale");
    }
  },
} satisfies MutationEvidenceFamily<(typeof INLINE_REFERENCE_MUTATION_KINDS)[number]>;

function isOwnedWithin(
  nodeOwners: Readonly<Record<string, string | null>>,
  nodeId: string,
  ancestorNodeId: string,
): boolean {
  const visited = new Set<string>();
  let cursor: string | null | undefined = nodeId;
  while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
    if (cursor === ancestorNodeId) {
      return true;
    }
    visited.add(cursor);
    cursor = nodeOwners[cursor];
  }
  return false;
}
