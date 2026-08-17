import { compareFacts, isViewMutation, type ContributionFact, type ViewMutation } from "../fact/index.js";
import { sequenceAnchorAt, type ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateViewMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isViewMutation(mutation)) {
    return null;
  }
  if (mutation.kind === "shared-default-view-definition-attach") {
    return noCompensation();
  }
  if (mutation.kind === "shared-default-view-definition-detach") {
    return compensateDetach(mutation, projection);
  }
  if (mutation.kind === "shared-default-view-definition-sort-by-name-set") {
    return {
      kind: "ready",
      mutations: [
        {
          ...mutation,
          enabled: mutation.previousEnabled,
          previousEnabled: mutation.enabled,
        },
      ],
    };
  }
  if (mutation.kind === "shared-default-view-definition-options-set") {
    if (mutation.previousOptions === undefined) {
      return noCompensation();
    }
    return {
      kind: "ready",
      mutations: [
        {
          ...mutation,
          options: mutation.previousOptions,
          previousOptions: mutation.options,
          observedOptionsFactIds: [target.id],
        },
      ],
    };
  }
  if (mutation.previousViewType == null) {
    return noCompensation();
  }
  const changedLater = activeFacts.some(
    (fact) =>
      compareFacts(target, fact) < 0 &&
      fact.body.mutation.kind === "shared-default-view-definition-mode-set" &&
      fact.body.mutation.viewDefinitionNodeId === mutation.viewDefinitionNodeId,
  );
  return changedLater
    ? noCompensation()
    : {
        kind: "ready",
        mutations: [
          {
            kind: "shared-default-view-definition-mode-set",
            viewDefinitionNodeId: mutation.viewDefinitionNodeId,
            viewType: mutation.previousViewType,
            previousViewType: mutation.viewType,
            observedModeFactIds: [target.id],
          },
        ],
      };
}

function compensateDetach(
  mutation: Extract<ViewMutation, { kind: "shared-default-view-definition-detach" }>,
  projection: ScopedProjection,
): CompensationStep {
  const trashNodeId = projection.workspaceSystemNodes.trash;
  if (trashNodeId === undefined) {
    return noCompensation();
  }
  return {
    kind: "ready",
    mutations: [
      { kind: "node-delete", nodeId: mutation.detachedValueNodeId },
      {
        kind: "node-owner-set",
        nodeId: mutation.detachedValueNodeId,
        ownerNodeId: trashNodeId,
        previousOwnerNodeId: mutation.attachmentNodeId,
      },
      {
        kind: "occurrence-move",
        occurrenceId: mutation.detachedValueOccurrenceId,
        parentNodeId: trashNodeId,
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        previousParentNodeId: mutation.attachmentNodeId,
        previousAnchor: sequenceAnchorAt(
          projection.childOccurrences[mutation.attachmentNodeId] ?? [],
          (projection.childOccurrences[mutation.attachmentNodeId] ?? []).indexOf(mutation.detachedValueOccurrenceId),
        ),
      },
      {
        kind: "shared-default-view-definition-attach",
        hostNodeId: mutation.hostNodeId,
        attachmentNodeId: mutation.attachmentNodeId,
        attachmentOccurrenceId: mutation.attachmentOccurrenceId,
        relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
        viewDefinitionNodeId: mutation.viewDefinitionNodeId,
        viewDefinitionOccurrenceId: mutation.viewDefinitionOccurrenceId,
      },
    ],
  };
}
