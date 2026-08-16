import { compareFacts, type ContributionFact, type Fact, type ProjectionPerspective } from "../fact/index.js";
import { deriveActivation, type Activation } from "./support.js";

export type ActiveContributions = Readonly<{
  facts: readonly ContributionFact[];
  activation: Activation;
}>;

export function deriveActiveContributions(
  facts: readonly Fact[],
  perspective: ProjectionPerspective,
): ActiveContributions {
  const activation = deriveActivation(facts, perspective);
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
