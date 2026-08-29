import { compareCausalOrder, isSupertagAction, type FactAction } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { supertagRelationAddress, supertagRelationEffect } from "./supertag-review.js";

export function supertagCandidates(
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    if (!isSupertagAction(fact.action)) {
      continue;
    }
    const address = supertagRelationAddress(fact.action, generation);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.values()].flatMap((facts): readonly HunkCandidate[] => {
    const last = [...facts].sort(compareCausalOrder).at(-1);
    if (!last || !isSupertagAction(last.action)) {
      return [];
    }
    const effect = supertagRelationEffect(last, generation);
    return effect.originIndex === effect.reviewIndex
      ? []
      : [
          {
            diffSpace: {
              kind: effect.relation === "application" ? "supertag-application" : "supertag-template",
              identity: supertagRelationAddress(last.action, generation),
            },
            targets: facts.map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}
