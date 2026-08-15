import { compareFacts, type ContributionFact, type Fact, type ViewMode } from "../fact/index.js";
import { deriveActivation, type Activation } from "./support.js";

export type ActiveContributions = Readonly<{
  facts: readonly ContributionFact[];
  activation: Activation;
}>;

export function deriveActiveContributions(facts: readonly Fact[], view: ViewMode): ActiveContributions {
  const activation = deriveActivation(facts, view);
  return {
    facts: facts
      .filter(
        (fact): fact is ContributionFact =>
          fact.body.kind === "contribution" && activation.activeContributionIds.has(fact.id),
      )
      .sort(compareFacts),
    activation,
  };
}
