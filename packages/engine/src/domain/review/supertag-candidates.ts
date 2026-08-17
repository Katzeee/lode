import { compareFacts, isSupertagMutation, type ContributionFact, type SupertagMutation } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { supertagRelationAddress, supertagRelationEffect } from "./supertag-review.js";

export function supertagCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isSupertagMutation(mutation)) {
      continue;
    }
    if (
      mutation.kind === "supertag-template-field-attach" ||
      mutation.kind === "supertag-template-field-existing-attach" ||
      mutation.kind === "supertag-template-field-detach" ||
      mutation.kind === "supertag-template-field-discoverability-set" ||
      mutation.kind === "supertag-optional-field-contribution-attach" ||
      mutation.kind === "supertag-optional-field-contribution-detach"
    ) {
      continue;
    }
    const address = supertagRelationAddress(mutation);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.values()].flatMap((facts): readonly HunkCandidate[] => candidateForGroup(facts, generation));
}

function candidateForGroup(
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const last = facts.at(-1)!;
  const supertagFact = supertagMutationFact(last);
  const effect = supertagRelationEffect(supertagFact, generation);
  return effect.originIndex === effect.reviewIndex
    ? []
    : [
        {
          diffSpace: {
            kind: effect.relation === "application" ? "supertag-application" : "supertag-template",
            identity: supertagRelationAddress(supertagFact.body.mutation),
          },
          targets: [...facts].sort(compareFacts).map((fact) => fact.id),
          bridges: [],
        },
      ];
}

type SupertagMutationFact = ContributionFact & Readonly<{ body: Readonly<{ mutation: SupertagMutation }> }>;

function supertagMutationFact(fact: ContributionFact): SupertagMutationFact {
  if (!isSupertagMutation(fact.body.mutation)) {
    throw new Error("Supertag Review group contains a non-Supertag Mutation");
  }
  return fact as SupertagMutationFact;
}
