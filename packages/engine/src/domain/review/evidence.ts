import { pendingProposalActivation } from "../activation/index.js";
import {
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { associatedReviewImpacts, normalizedReviewEffects } from "./review-plan.js";
import type { DecisionEvidence } from "./types.js";

export function evidenceForTargets(
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  targetIds: readonly string[],
  context = createReviewEvidenceContext(snapshot),
): DecisionEvidence | null {
  const closure = proposalClosure(targetIds, context.pending, context.supportByContribution);
  const targets = closure
    .map((id) => context.pending.get(id))
    .filter((fact): fact is ContributionFact => fact !== undefined)
    .sort(compareFacts);
  if (targets.length !== closure.length) {
    return null;
  }
  const effects = normalizedReviewEffects(targets, generation);
  if (effects.length === 0) {
    return null;
  }
  return {
    proposalTargets: targets.map((fact) => fact.id).sort(stableStringCompare),
    supportClosure: closure,
    effects,
    associatedImpactIds: associatedReviewImpacts(targets, generation),
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
}

export type ReviewEvidenceContext = Readonly<{
  pending: ReadonlyMap<string, ContributionFact>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
}>;

export function createReviewEvidenceContext(snapshot: FactSnapshot): ReviewEvidenceContext {
  return pendingProposalActivation(snapshot);
}

function proposalClosure(
  targetIds: readonly string[],
  pending: ReadonlyMap<string, ContributionFact>,
  supportByContribution: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const transactionMembers = new Map<string, string[]>();
  for (const fact of pending.values()) {
    const members = transactionMembers.get(fact.transaction.transactionId) ?? [];
    members.push(fact.id);
    transactionMembers.set(fact.transaction.transactionId, members);
  }
  const closure = new Set<string>();
  const queue = [...targetIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const fact = pending.get(id);
    if (!fact || closure.has(id)) {
      continue;
    }
    closure.add(id);
    queue.push(...(transactionMembers.get(fact.transaction.transactionId) ?? []));
    queue.push(...(supportByContribution.get(id) ?? []));
  }
  return [...closure].sort(stableStringCompare);
}
