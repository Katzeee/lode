import type { Fact, FactId, FactSnapshot } from "../fact/index.js";
import { historySteps } from "./state.js";

/**
 * A channel's later step and its compensation are not independent edits of an
 * earlier step. Exclude the same pair from counterfactuals and rule attribution;
 * the authoritative snapshot and other channels remain intact.
 */
export function neutralizedLaterFacts(targetFacts: readonly Fact[], snapshot: FactSnapshot): ReadonlySet<FactId> {
  const targetIds = new Set(targetFacts.map((fact) => fact.id));
  const steps = historySteps(snapshot);
  const owner = steps.find((step) => step.actionFacts.some((fact) => targetIds.has(fact.id)));
  if (!owner) {
    return new Set();
  }
  const later = steps.slice(steps.indexOf(owner) + 1).filter((step) => step.body.channelId === owner.body.channelId);
  const roots = new Map<FactId, FactId>();
  const lineages = new Map<FactId, typeof later>();
  for (const step of later) {
    const target = step.body.targetStepId;
    const root = target === null ? step.id : (roots.get(target) ?? step.id);
    roots.set(step.id, root);
    lineages.set(root, [...(lineages.get(root) ?? []), step]);
  }
  return new Set(
    [...lineages.values()].flatMap((lineage) =>
      lineage
        .slice(0, lineage.length - (lineage.length % 2))
        .flatMap((step) => step.actionFacts.map((fact) => fact.id)),
    ),
  );
}
