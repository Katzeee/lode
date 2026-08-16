import { compareFacts, isViewMutation, type ContributionFact } from "../fact/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateViewMutation(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (!isViewMutation(mutation)) {
    return null;
  }
  if (mutation.kind === "shared-default-view-definition-attach" || mutation.previousViewType == null) {
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
