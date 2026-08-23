import { canonicalJson, factActions, type FactSnapshot } from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";

export function resolutionAdjudicationProblem(
  snapshot: FactSnapshot,
  proposalFactIds: readonly string[],
  resolutionIds: readonly string[],
): string | null {
  const activation = deriveActivation(snapshot.facts, "review");
  const expected = new Set<string>();
  const requestedProposals = canonicalJson([...proposalFactIds].sort());
  let expectedCandidateSet: string | null = null;
  for (const proposalFactId of proposalFactIds) {
    const proposal = snapshot.facts.find((fact) => fact.id === proposalFactId);
    const factActionIds = proposal ? factActions(proposal).map((action) => action.id) : [];
    const firstActionId = factActionIds[0];
    const candidates = firstActionId ? (activation.resolutionByAction.get(firstActionId) ?? []) : [];
    if (new Set(candidates.map((candidate) => candidate.body.decision)).size < 2) {
      return `Proposal Fact has no Resolution conflict: ${proposalFactId}`;
    }
    if (
      candidates.some((candidate) => canonicalJson([...candidate.body.proposalFactIds].sort()) !== requestedProposals)
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
