import type { ContributionFact, FactSnapshot } from "../fact/index.js";
import { deriveActivation } from "./support.js";

export type PendingProposalActivation = Readonly<{
  pending: ReadonlyMap<string, ContributionFact>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
}>;

export function pendingProposalActivation(snapshot: FactSnapshot): PendingProposalActivation {
  const origin = deriveActivation(snapshot.facts, "origin");
  const review = deriveActivation(snapshot.facts, "review");
  const pending = new Map(
    snapshot.facts
      .filter(
        (fact): fact is ContributionFact =>
          fact.body.kind === "contribution" &&
          fact.body.intent === "proposal" &&
          review.activeContributionIds.has(fact.id) &&
          !origin.activeContributionIds.has(fact.id),
      )
      .map((fact) => [fact.id, fact]),
  );
  return { pending, supportByContribution: review.supportByContribution };
}

export function pendingProposalFacts(snapshot: FactSnapshot): ReadonlyMap<string, ContributionFact> {
  return pendingProposalActivation(snapshot).pending;
}
