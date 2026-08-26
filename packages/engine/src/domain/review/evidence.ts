import { pendingProposalActivation } from "../activation/index.js";
import {
  compareCausalOrder,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { associatedReviewImpacts, normalizedReviewEffects } from "./review-plan.js";
import type { DecisionEvidence } from "./types.js";

export function evidenceForTargets(
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  targetIds: readonly FactActionId[],
  context = createReviewEvidenceContext(snapshot),
): DecisionEvidence | null {
  const closure = proposalClosure(targetIds, context.pending, context.supportByAction);
  const targets = closure
    .map((id) => context.pending.get(id))
    .filter((action): action is FactAction => action !== undefined)
    .sort(compareCausalOrder);
  if (targets.length !== closure.length) {
    return null;
  }
  const effects = normalizedReviewEffects(targets, generation);
  if (effects.length === 0) {
    return null;
  }
  return {
    proposalActionIds: targets.map((action) => action.id).sort(stableStringCompare),
    effects,
    associatedImpactIds: associatedReviewImpacts(targets, generation),
  };
}

export type ReviewEvidenceContext = Readonly<{
  pending: ReadonlyMap<FactActionId, FactAction>;
  supportByAction: ReadonlyMap<FactActionId, readonly FactActionId[]>;
}>;

export function createReviewEvidenceContext(snapshot: FactSnapshot): ReviewEvidenceContext {
  return pendingProposalActivation(snapshot);
}

function proposalClosure(
  targetIds: readonly FactActionId[],
  pending: ReadonlyMap<FactActionId, FactAction>,
  supportByAction: ReadonlyMap<FactActionId, readonly FactActionId[]>,
): readonly FactActionId[] {
  const actionsFromSameFact = new Map<string, FactActionId[]>();
  for (const fact of pending.values()) {
    const members = actionsFromSameFact.get(fact.factId) ?? [];
    members.push(fact.id);
    actionsFromSameFact.set(fact.factId, members);
  }
  const closure = new Set<FactActionId>();
  const queue = [...targetIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const fact = pending.get(id);
    if (!fact || closure.has(id)) {
      continue;
    }
    closure.add(id);
    queue.push(...(actionsFromSameFact.get(fact.factId) ?? []));
    queue.push(...(supportByAction.get(id) ?? []));
  }
  return [...closure].sort(stableStringCompare);
}
