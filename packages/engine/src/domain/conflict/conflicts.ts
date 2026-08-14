import { canonicalJson, type FactSnapshot } from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";

export function resolutionAdjudicationProblem(
  snapshot: FactSnapshot,
  proposalContributionIds: readonly string[],
  resolutionIds: readonly string[],
): string | null {
  const activation = deriveActivation(snapshot.facts, "review");
  const expected = new Set<string>();
  const requestedProposals = canonicalJson([...proposalContributionIds].sort());
  let expectedCandidateSet: string | null = null;
  for (const contributionId of proposalContributionIds) {
    const candidates = activation.resolutionByContribution.get(contributionId) ?? [];
    if (new Set(candidates.map((candidate) => candidate.body.decision)).size < 2) {
      return `Proposal Contribution has no Resolution conflict: ${contributionId}`;
    }
    if (
      candidates.some(
        (candidate) =>
          canonicalJson([...candidate.body.proposalContributionIds].sort()) !== requestedProposals,
      )
    ) {
      return "Adjudication Proposal targets do not match one Resolution conflict";
    }
    const candidateSet = canonicalJson(candidates.map((candidate) => candidate.id).sort());
    if (expectedCandidateSet !== null && candidateSet !== expectedCandidateSet) {
      return "Adjudication Proposal targets span multiple Resolution conflicts";
    }
    expectedCandidateSet = candidateSet;
    candidates.forEach((candidate) => expected.add(candidate.id));
  }
  return canonicalJson([...expected].sort()) === canonicalJson([...resolutionIds].sort())
    ? null
    : "Adjudication targets do not match the current Resolution conflict";
}
