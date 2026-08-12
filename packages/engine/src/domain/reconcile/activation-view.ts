import type { ContributionFact, Fact, ResolutionFact, ViewMode } from "../fact/index.js";

export function resolutionsByContribution(
  facts: readonly Fact[],
): ReadonlyMap<string, readonly ResolutionFact[]> {
  const resolutions = new Map<string, ResolutionFact[]>();
  const superseded = new Set(
    facts.flatMap((fact) => (isResolution(fact) ? fact.body.adjudicatesResolutionIds : [])),
  );
  for (const fact of facts) {
    if (!isResolution(fact) || superseded.has(fact.id)) {
      continue;
    }
    for (const contributionId of fact.body.proposalContributionIds) {
      const current = resolutions.get(contributionId) ?? [];
      current.push(fact);
      resolutions.set(contributionId, current);
    }
  }
  return resolutions;
}

export function eligibleForView(
  contribution: ContributionFact,
  resolutions: readonly ResolutionFact[] | undefined,
  mode: ViewMode,
): boolean {
  if (contribution.body.intent === "direct") {
    return true;
  }
  const decisions = new Set(resolutions?.map((resolution) => resolution.body.decision) ?? []);
  if (decisions.size > 1) {
    return mode === "review";
  }
  if (decisions.has("reject")) {
    return false;
  }
  if (decisions.has("accept")) {
    return true;
  }
  return mode === "review";
}

function isResolution(fact: Fact): fact is ResolutionFact {
  return fact.body.kind === "resolution";
}
