import {
  canonicalJson,
  isProposableAction,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
  type ProposableAction,
} from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import { fieldMaterializationReviewFamily } from "./field-materialization-review-family.js";
import { lifecycleReviewFamily } from "./lifecycle-review-family.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { supertagReviewFamily } from "./supertag-review-family.js";
import { structureReviewFamily } from "./structure-review-family.js";
import { textReviewFamily } from "./text-review-family.js";
import type { DecisionEffect } from "./types.js";
import { searchExpressionReviewFamily } from "./search-expression-review-family.js";
import { inlineReferenceReviewFamily } from "./inline-reference-review-family.js";
import { viewDefinitionReviewFamily } from "./view-definition-review-family.js";
import { fieldDefinitionConfigurationReviewFamily } from "./field-definition-configuration-review-family.js";
import { fieldDefinitionLifecycleReviewFamily } from "./field-definition-lifecycle-review-family.js";

const REVIEW_FAMILIES = [
  textReviewFamily,
  structureReviewFamily,
  lifecycleReviewFamily,
  searchExpressionReviewFamily,
  inlineReferenceReviewFamily,
  viewDefinitionReviewFamily,
  fieldDefinitionConfigurationReviewFamily,
  fieldDefinitionLifecycleReviewFamily,
  supertagReviewFamily,
  fieldMaterializationReviewFamily,
] as const satisfies readonly ReviewFamilyRule[];

type OwnedActionKind = (typeof REVIEW_FAMILIES)[number]["actionKinds"][number];
type AssertNever<Value extends never> = Value;
type ReviewedActionKind =
  AssertNever<Exclude<ProposableAction["kind"], OwnedActionKind>> extends never ? ProposableAction["kind"] : never;

const FAMILY_BY_ACTION = compileReviewFamilies(REVIEW_FAMILIES);

export function collectReviewCandidates(
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactActionId, FactAction>,
): readonly HunkCandidate[] {
  const context = { snapshot, generation, pending };
  return REVIEW_FAMILIES.flatMap((family) => family.candidates(context));
}

export function reviewPaginationScopeKeys(
  fact: FactAction,
  occurrence: (occurrenceId: string) => Readonly<{ nodeId: string; parentNodeId: string }> | null,
): readonly string[] {
  if (!isProposableFact(fact)) {
    throw new Error(`Review scope requires a Proposable Action: ${fact.action.kind}`);
  }
  const family = familyFor(fact.action.kind);
  return family.scopes(fact, { occurrence });
}

export function normalizedReviewEffects(
  targets: readonly FactAction[],
  generation: InterpretedProjectionGeneration,
): readonly DecisionEffect[] {
  const effects = new Map<string, DecisionEffect>();
  for (const fact of targets) {
    if (!isProposableFact(fact)) {
      throw new Error(`Review effect requires a Proposable Action: ${fact.action.kind}`);
    }
    const family = familyFor(fact.action.kind);
    const entry = family.effect(fact, targets, generation);
    if (entry) {
      effects.set(entry.identity, entry.effect);
    }
  }
  return [...effects.values()].sort((left, right) => stableStringCompare(canonicalJson(left), canonicalJson(right)));
}

function familyFor(kind: ProposableAction["kind"]): ReviewFamilyRule {
  const family = FAMILY_BY_ACTION.get(kind);
  if (!family) {
    throw new Error(`Review AuthoredAction has no family owner: ${kind}`);
  }
  return family;
}

function isProposableFact(fact: FactAction): fact is FactAction<ProposableAction> {
  return isProposableAction(fact.action);
}

export function associatedReviewImpacts(
  targets: readonly FactAction[],
  generation: InterpretedProjectionGeneration,
): readonly string[] {
  const impacts = new Set<string>();
  for (const family of REVIEW_FAMILIES) {
    family.addImpacts(impacts, targets, generation);
  }
  return [...impacts].sort(stableStringCompare);
}

function compileReviewFamilies(
  families: readonly ReviewFamilyRule[],
): ReadonlyMap<ReviewedActionKind, ReviewFamilyRule> {
  const byAction = new Map<ReviewedActionKind, ReviewFamilyRule>();
  for (const family of families) {
    for (const kind of family.actionKinds) {
      const owner = byAction.get(kind);
      if (owner) {
        throw new Error(`Review AuthoredAction ${kind} has duplicate family owners: ${owner.key}, ${family.key}`);
      }
      byAction.set(kind, family);
    }
  }
  return byAction;
}
