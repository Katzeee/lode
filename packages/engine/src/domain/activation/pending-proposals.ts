import { factActionsFromFacts, type FactAction, type FactActionId, type FactSnapshot } from "../fact/index.js";
import { deriveActivation } from "./support.js";

type PendingProposalActivation = Readonly<{
  pending: ReadonlyMap<FactActionId, FactAction>;
  supportByAction: ReadonlyMap<FactActionId, readonly FactActionId[]>;
}>;

export function pendingProposalActivation(snapshot: FactSnapshot): PendingProposalActivation {
  const origin = deriveActivation(snapshot.facts, "origin");
  const review = deriveActivation(snapshot.facts, "review");
  const pending = new Map(
    factActionsFromFacts(snapshot.facts)
      .filter(
        (action) =>
          action.intent === "proposal" &&
          review.activeActionIds.has(action.id) &&
          !origin.activeActionIds.has(action.id),
      )
      .map((action) => [action.id, action]),
  );
  return { pending, supportByAction: review.supportByAction };
}

export function pendingProposalActions(snapshot: FactSnapshot): ReadonlyMap<FactActionId, FactAction> {
  return pendingProposalActivation(snapshot).pending;
}
