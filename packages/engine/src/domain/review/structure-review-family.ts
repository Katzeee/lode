import { canonicalJson, compareCausalOrder, type FactAction, type PlacementAction } from "../fact/index.js";
import { impactAddress, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { mergeLocalStructureCandidates } from "./structure-candidates.js";
import {
  isStructuralPlacementAction,
  actionAnchor,
  structuralOccurrenceId,
  structureEffect,
  structureEffectChanged,
  type StructuralPlacementAction,
} from "./structure-effect.js";
import { childSequenceIdentity } from "./structure-space.js";
import {
  associatedOccurrenceScopes,
  fieldContentRemovalScopes,
  reviewScope,
  structureParentScope,
  type ReviewScopeContext,
} from "./review-scope.js";

const STRUCTURE_ACTION_KINDS = [
  "placement-create",
  "placement-remove",
  "placement-move",
  "field-value-remove",
] as const;

export const structureReviewFamily = {
  key: "structure",
  actionKinds: STRUCTURE_ACTION_KINDS,
  scopes(fact, context) {
    const action = fact.action;
    if (!isStructureReviewAction(action)) {
      throw new Error("Structure Review family received another AuthoredAction family");
    }
    return action.kind === "field-value-remove"
      ? fieldContentRemovalScopes(action, context)
      : occurrenceScopes(action, context);
  },
  candidates: ({ snapshot, generation, pending }) =>
    mergeLocalStructureCandidates(structureCandidates(generation, pending), snapshot, generation),
  effect(fact, _targets, generation) {
    const action = fact.action;
    if (!isStructureReviewAction(action)) {
      throw new Error("Structure Review family received another AuthoredAction family");
    }
    const occurrenceId = structuralOccurrenceId(action);
    const effect = structureEffect(occurrenceId, generation, actionAnchor(action));
    return structureEffectChanged(effect) ? { identity: `structure/${occurrenceId}`, effect } : null;
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const action = fact.action;
      if (action.kind === "placement-create") {
        addNodeReviewImpacts(impacts, action.nodeId, generation);
      }
      if (!isStructuralPlacementAction(action)) {
        continue;
      }
      const occurrenceId = structuralOccurrenceId(action);
      impacts.add(occurrenceId);
      const effect = structureEffect(occurrenceId, generation, actionAnchor(action));
      impacts.add(impactAddress("occurrence", occurrenceId, "origin-parent", effect.originParentId));
      impacts.add(impactAddress("occurrence", occurrenceId, "review-parent", effect.reviewParentId));
      impacts.add(impactAddress("occurrence", occurrenceId, "anchor", canonicalJson(effect.anchor)));
      impacts.add(impactAddress("occurrence", occurrenceId, "origin", canonicalJson(effect.originRelation)));
      impacts.add(impactAddress("occurrence", occurrenceId, "review", canonicalJson(effect.reviewRelation)));
    }
  },
} satisfies ReviewFamilyRule;

function occurrenceScopes(action: PlacementAction, context: ReviewScopeContext): readonly string[] {
  if (action.kind === "placement-create") {
    return [
      structureParentScope(action.parentNodeId),
      ...associatedOccurrenceScopes(action.placementId, action.nodeId),
    ];
  }
  const previous = context.occurrence(action.placementId);
  const association = associatedOccurrenceScopes(action.placementId, previous?.nodeId);
  if (action.kind === "placement-remove") {
    return [
      reviewScope("structure-occurrence", action.placementId),
      ...(previous ? [structureParentScope(previous.parentNodeId)] : []),
      ...association,
    ];
  }
  return [
    ...new Set([
      structureParentScope(action.parentNodeId),
      ...(previous ? [structureParentScope(previous.parentNodeId)] : []),
      ...association,
    ]),
  ];
}

function structureCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const grouped = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    const action = fact.action;
    if (!isStructureReviewAction(action)) {
      continue;
    }
    const occurrenceId = structuralOccurrenceId(action);
    const group = grouped.get(occurrenceId) ?? [];
    group.push(fact);
    grouped.set(occurrenceId, group);
  }
  return [...grouped.entries()].flatMap(([occurrenceId, facts]) =>
    candidatesForOccurrence(occurrenceId, facts, generation),
  );
}

function candidatesForOccurrence(
  occurrenceId: string,
  facts: readonly FactAction[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const ordered = [...facts].sort(compareCausalOrder);
  const action = ordered.at(-1)?.action;
  if (!action || !isStructureReviewAction(action)) {
    throw new Error("Structure Review group contains another AuthoredAction family");
  }
  const effect = structureEffect(occurrenceId, generation, actionAnchor(action));
  if (!structureEffectChanged(effect)) {
    return [];
  }
  const parentIds =
    effect.originPresent && effect.reviewPresent && effect.originParentId !== effect.reviewParentId
      ? [effect.originParentId, effect.reviewParentId]
      : [!effect.originPresent ? effect.reviewParentId : effect.originParentId];
  return [...new Set(parentIds)].flatMap((parentId) =>
    parentId === null
      ? []
      : {
          diffSpace: {
            kind: "child-sequence" as const,
            identity: childSequenceIdentity(parentId),
          },
          targets: ordered.map((fact) => fact.id),
          bridges: [],
        },
  );
}

function isStructureReviewAction(action: FactAction["action"]): action is StructuralPlacementAction {
  return isStructuralPlacementAction(action);
}
