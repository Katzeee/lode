import { canonicalJson, stableStringCompare, type FactSnapshot } from "../fact/index.js";
import type { ProjectionGeneration } from "../reconcile/index.js";
import { deriveActivation } from "../reconcile/support.js";
import type { ConflictQuery } from "./types.js";

export function queryConflicts(
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  after: string | null = null,
  limit = 50,
): ConflictQuery {
  const issues = Object.values(generation.review.conflictIssues);
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const page = issues
    .filter((issue) => after === null || stableStringCompare(issue.identity, after) > 0)
    .slice(0, boundedLimit);
  const last = page.at(-1)?.identity ?? null;
  return {
    generationId: generation.identity.generationId,
    frontier: snapshot.frontier,
    issues: page,
    next:
      last !== null && issues.some((issue) => stableStringCompare(issue.identity, last) > 0)
        ? last
        : null,
  };
}

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
