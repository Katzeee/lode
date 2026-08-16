import type { ContributionFact } from "../fact/index.js";
import { locateInlineReference, type ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateInlineReferenceMutation(
  target: ContributionFact,
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (
    mutation.kind !== "inline-reference-create" &&
    mutation.kind !== "inline-reference-delete" &&
    mutation.kind !== "inline-reference-alias-attach" &&
    mutation.kind !== "inline-reference-alias-detach"
  ) {
    return null;
  }
  const location = locateInlineReference(projection.nodes, mutation.inlineReferenceId);
  switch (mutation.kind) {
    case "inline-reference-create":
      return location?.reference.contributionId !== target.id
        ? noCompensation()
        : {
            kind: "ready",
            mutations: [
              {
                kind: "inline-reference-delete",
                inlineReferenceId: mutation.inlineReferenceId,
                previousHostNodeId: location.hostNodeId,
                previousTargetNodeId: location.reference.targetNodeId,
                previousAnchor: location.anchor,
              },
            ],
          };
    case "inline-reference-delete":
      return location !== null ||
        mutation.previousHostNodeId === undefined ||
        mutation.previousTargetNodeId === undefined ||
        mutation.previousAnchor === undefined
        ? noCompensation()
        : {
            kind: "ready",
            mutations: [
              {
                kind: "inline-reference-create",
                inlineReferenceId: mutation.inlineReferenceId,
                hostNodeId: mutation.previousHostNodeId,
                targetNodeId: mutation.previousTargetNodeId,
                anchor: mutation.previousAnchor,
              },
            ],
          };
    case "inline-reference-alias-attach":
      return location?.reference.aliasNodeId !== mutation.aliasNodeId
        ? noCompensation()
        : {
            kind: "ready",
            mutations: [
              {
                kind: "inline-reference-alias-detach",
                inlineReferenceId: mutation.inlineReferenceId,
                aliasNodeId: mutation.aliasNodeId,
              },
            ],
          };
    case "inline-reference-alias-detach":
      return location === null ||
        location.reference.aliasNodeId !== null ||
        projection.nodes[mutation.aliasNodeId] === undefined
        ? noCompensation()
        : {
            kind: "ready",
            mutations: [
              {
                kind: "inline-reference-alias-attach",
                inlineReferenceId: mutation.inlineReferenceId,
                aliasNodeId: mutation.aliasNodeId,
              },
            ],
          };
  }
}
