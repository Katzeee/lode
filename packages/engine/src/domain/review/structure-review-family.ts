import { canonicalJson, compareFacts, type ContributionFact, type OccurrenceMutation } from "../fact/index.js";
import { impactAddress, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { nodeCreationPlacements } from "./node-creation-placement.js";
import { mergeLocalStructureCandidates } from "./structure-candidates.js";
import {
  isStructuralOccurrenceMutation,
  mutationAnchor,
  structuralOccurrenceId,
  structureEffect,
  structureEffectChanged,
  type StructuralOccurrenceMutation,
} from "./structure-effect.js";
import { childSequenceIdentity } from "./structure-space.js";
import {
  associatedOccurrenceScopes,
  fieldContentDeletionScopes,
  reviewScope,
  structureParentScope,
  type ReviewScopeContext,
} from "./review-scope.js";

const STRUCTURE_MUTATION_KINDS = [
  "occurrence-create",
  "occurrence-delete",
  "occurrence-restore",
  "occurrence-move",
  "field-value-delete",
] as const;

export const structureReviewFamily = {
  key: "structure",
  mutationKinds: STRUCTURE_MUTATION_KINDS,
  scopes(fact, context) {
    const mutation = fact.body.mutation;
    if (!isStructureReviewMutation(mutation)) {
      throw new Error("Structure Review family received another Mutation family");
    }
    return mutation.kind === "field-value-delete"
      ? fieldContentDeletionScopes(mutation)
      : occurrenceScopes(mutation, context);
  },
  candidates: ({ snapshot, generation, pending }) =>
    mergeLocalStructureCandidates(structureCandidates(generation, pending), snapshot, generation),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isStructureReviewMutation(mutation)) {
      throw new Error("Structure Review family received another Mutation family");
    }
    const occurrenceId = structuralOccurrenceId(mutation);
    const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
    return structureEffectChanged(effect) ? { identity: `structure/${occurrenceId}`, effect } : null;
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (mutation.kind === "occurrence-create") {
        addNodeReviewImpacts(impacts, mutation.nodeId, generation);
      }
      if (!isStructuralOccurrenceMutation(mutation)) {
        continue;
      }
      const occurrenceId = structuralOccurrenceId(mutation);
      impacts.add(occurrenceId);
      const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
      impacts.add(impactAddress("occurrence", occurrenceId, "origin-parent", effect.originParentId));
      impacts.add(impactAddress("occurrence", occurrenceId, "review-parent", effect.reviewParentId));
      impacts.add(impactAddress("occurrence", occurrenceId, "anchor", canonicalJson(effect.anchor)));
      impacts.add(impactAddress("occurrence", occurrenceId, "origin", canonicalJson(effect.originRelation)));
      impacts.add(impactAddress("occurrence", occurrenceId, "review", canonicalJson(effect.reviewRelation)));
    }
  },
} satisfies ReviewFamilyRule;

function occurrenceScopes(mutation: OccurrenceMutation, context: ReviewScopeContext): readonly string[] {
  if (mutation.kind === "occurrence-create") {
    return [
      structureParentScope(mutation.parentNodeId),
      ...associatedOccurrenceScopes(mutation.occurrenceId, mutation.nodeId),
    ];
  }
  const association = associatedOccurrenceScopes(
    mutation.occurrenceId,
    context.occurrenceNodeId(mutation.occurrenceId) ?? undefined,
  );
  if (mutation.kind === "occurrence-restore") {
    return [structureParentScope(mutation.parentNodeId), ...association];
  }
  if (mutation.kind === "occurrence-delete") {
    return [
      ...(mutation.previousParentNodeId === undefined
        ? [reviewScope("structure-occurrence", mutation.occurrenceId)]
        : [structureParentScope(mutation.previousParentNodeId)]),
      ...association,
    ];
  }
  return [
    ...new Set([
      structureParentScope(mutation.parentNodeId),
      ...(mutation.previousParentNodeId === undefined ? [] : [structureParentScope(mutation.previousParentNodeId)]),
      ...association,
    ]),
  ];
}

function structureCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const grouped = new Map<string, ContributionFact[]>();
  const creationPlacementIds = new Set(nodeCreationPlacements(pending).values());
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isStructureReviewMutation(mutation) || creationPlacementIds.has(fact.id)) {
      continue;
    }
    const occurrenceId = structuralOccurrenceId(mutation);
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
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const ordered = [...facts].sort(compareFacts);
  const mutation = ordered.at(-1)?.body.mutation;
  if (!mutation || !isStructureReviewMutation(mutation)) {
    throw new Error("Structure Review group contains another Mutation family");
  }
  const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
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

function isStructureReviewMutation(
  mutation: ContributionFact["body"]["mutation"],
): mutation is Exclude<StructuralOccurrenceMutation, { kind: "materialized-field-delete" }> {
  return isStructuralOccurrenceMutation(mutation) && mutation.kind !== "materialized-field-delete";
}
