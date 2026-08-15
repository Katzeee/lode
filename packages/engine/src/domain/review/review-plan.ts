import {
  canonicalJson,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { fieldMaterializationReviewFamily } from "./field-materialization-review-family.js";
import { lifecycleReviewFamily } from "./lifecycle-review-family.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { schemaReviewFamily } from "./schema-review-family.js";
import { structureReviewFamily } from "./structure-review-family.js";
import { textReviewFamily } from "./text-review-family.js";
import type { DecisionEffect } from "./types.js";
import { valueReviewFamily } from "./value-review-family.js";

const REVIEW_FAMILIES = [
  textReviewFamily,
  structureReviewFamily,
  valueReviewFamily,
  lifecycleReviewFamily,
  schemaReviewFamily,
  fieldMaterializationReviewFamily,
] as const satisfies readonly ReviewFamilyRule[];

type OwnedMutationKind = (typeof REVIEW_FAMILIES)[number]["mutationKinds"][number];
type AssertNever<Value extends never> = Value;
export type ReviewMutationOwnershipIsComplete = AssertNever<Exclude<Mutation["kind"], OwnedMutationKind>>;

const FAMILY_BY_MUTATION = compileReviewFamilies(REVIEW_FAMILIES);

export function collectReviewCandidates(
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const context = { snapshot, generation, pending };
  return REVIEW_FAMILIES.flatMap((family) => family.candidates(context));
}

export function reviewPaginationScopeKeys(
  fact: ContributionFact,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): readonly string[] {
  const family = familyFor(fact.body.mutation.kind);
  return family.scopes(fact, { occurrenceNodeId });
}

export function normalizedReviewEffects(
  targets: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly DecisionEffect[] {
  const effects = new Map<string, DecisionEffect>();
  for (const fact of targets) {
    const family = familyFor(fact.body.mutation.kind);
    const entry = family.effect(fact, targets, generation);
    if (entry) {
      effects.set(entry.identity, entry.effect);
    }
  }
  return [...effects.values()].sort((left, right) => stableStringCompare(canonicalJson(left), canonicalJson(right)));
}

function familyFor(kind: Mutation["kind"]): ReviewFamilyRule {
  const family = FAMILY_BY_MUTATION.get(kind);
  if (!family) {
    throw new Error(`Review Mutation has no family owner: ${kind}`);
  }
  return family;
}

export function associatedReviewImpacts(
  targets: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly string[] {
  const impacts = new Set<string>();
  for (const family of REVIEW_FAMILIES) {
    family.addImpacts(impacts, targets, generation);
  }
  return [...impacts].sort(stableStringCompare);
}

function compileReviewFamilies(families: readonly ReviewFamilyRule[]): ReadonlyMap<Mutation["kind"], ReviewFamilyRule> {
  const byMutation = new Map<Mutation["kind"], ReviewFamilyRule>();
  for (const family of families) {
    for (const kind of family.mutationKinds) {
      const owner = byMutation.get(kind);
      if (owner) {
        throw new Error(`Review Mutation ${kind} has duplicate family owners: ${owner.key}, ${family.key}`);
      }
      byMutation.set(kind, family);
    }
  }
  return byMutation;
}
