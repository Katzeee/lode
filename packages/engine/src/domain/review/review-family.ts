import type { ContributionFact, FactSnapshot, Mutation, TextAtomId } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import type { DecisionEffect, ReviewHunk } from "./types.js";

export type HunkCandidate = Readonly<{
  diffSpace: ReviewHunk["diffSpace"];
  targets: readonly string[];
  bridges: readonly TextAtomId[];
}>;

export type ReviewFamilyContext = Readonly<{
  snapshot: FactSnapshot;
  generation: ScopedProjectionGeneration;
  pending: ReadonlyMap<string, ContributionFact>;
}>;

export type ReviewEffectEntry = Readonly<{
  identity: string;
  effect: DecisionEffect;
}>;

export type ReviewFamilyRule = Readonly<{
  key: string;
  mutationKinds: readonly Mutation["kind"][];
  candidates(context: ReviewFamilyContext): readonly HunkCandidate[];
  effect(
    fact: ContributionFact,
    targets: readonly ContributionFact[],
    generation: ScopedProjectionGeneration,
  ): ReviewEffectEntry | null;
  addImpacts(
    impacts: Set<string>,
    targets: readonly ContributionFact[],
    generation: ScopedProjectionGeneration,
  ): void;
}>;
