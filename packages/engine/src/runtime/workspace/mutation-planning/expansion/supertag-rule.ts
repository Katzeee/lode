import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { SupertagMutation } from "../../../../domain/fact/index.js";
import { occurrenceAnchor, type ScopedProjection } from "../../../../domain/reconcile/index.js";
import { deletePlacement } from "./deletion-rule.js";
import { createOccurrenceUnlessPresent } from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

export function expandSupertagMutation(mutation: SupertagMutation, available: ScopedProjection): MutationWrite {
  switch (mutation.kind) {
    case "supertag-template-node-add":
      return atomicExpansion([
        ...createOccurrenceUnlessPresent(
          mutation.templateOccurrenceId,
          mutation.templateNodeId,
          mutation.supertagId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "supertag-template-node-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.templateOccurrenceId, available)]);
    case "supertag-apply":
      return singleMutationWrite(mutation);
    case "supertag-remove":
      return detachSupertagApplication(mutation, available);
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "supertag-template-field-attach":
    case "supertag-template-field-existing-attach":
    case "supertag-template-field-detach":
    case "supertag-template-field-discoverability-set":
    case "supertag-template-field-visibility-configure":
    case "supertag-optional-field-contribution-attach":
    case "supertag-optional-field-contribution-detach":
      return singleMutationWrite(mutation);
  }
}

function detachSupertagApplication(
  mutation: Extract<SupertagMutation, { kind: "supertag-remove" }>,
  available: ScopedProjection,
): MutationWrite {
  const occurrence = available.occurrences[mutation.applicationOccurrenceId];
  const definitionOccurrence = available.occurrences[mutation.definitionOccurrenceId];
  const ownerNodeId = available.nodeOwners[mutation.applicationNodeId];
  if (
    occurrence?.nodeId !== mutation.applicationNodeId ||
    definitionOccurrence?.nodeId !== mutation.supertagId ||
    definitionOccurrence.parentNodeId !== mutation.applicationNodeId ||
    ownerNodeId === undefined ||
    ownerNodeId === null ||
    occurrence.parentNodeId !== ownerNodeId ||
    available.nodes[mutation.detachedValueNodeId] !== undefined ||
    available.occurrences[mutation.detachedValueOccurrenceId] !== undefined
  ) {
    throw new Error("Supertag Application has no active owning placement");
  }
  return atomicExpansion([
    mutation,
    { kind: "node-create", nodeId: mutation.detachedValueNodeId },
    {
      kind: "node-owner-set",
      nodeId: mutation.detachedValueNodeId,
      ownerNodeId: mutation.applicationNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-delete",
      occurrenceId: mutation.definitionOccurrenceId,
      previousParentNodeId: definitionOccurrence.parentNodeId,
      previousAnchor: occurrenceAnchor(available, definitionOccurrence.occurrenceId),
    },
    {
      kind: "occurrence-create",
      occurrenceId: mutation.detachedValueOccurrenceId,
      nodeId: mutation.detachedValueNodeId,
      parentNodeId: mutation.applicationNodeId,
      anchor: occurrenceAnchor(available, definitionOccurrence.occurrenceId),
    },
    {
      kind: "node-owner-set",
      nodeId: mutation.applicationNodeId,
      ownerNodeId: null,
      previousOwnerNodeId: ownerNodeId,
    },
    {
      kind: "occurrence-delete",
      occurrenceId: mutation.applicationOccurrenceId,
      previousParentNodeId: occurrence.parentNodeId,
      previousAnchor: occurrenceAnchor(available, occurrence.occurrenceId),
    },
  ]);
}
