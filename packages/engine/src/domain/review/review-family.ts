import type { FactAction, FactActionId, FactSnapshot, ProposableAction, TextAtomId } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import type { DecisionEffect, ReviewHunk } from "./types.js";
import type { ReviewScopeContext } from "./review-scope.js";

export type HunkCandidate = Readonly<{
  diffSpace: ReviewHunk["diffSpace"];
  targets: readonly FactActionId[];
  bridges: readonly TextAtomId[];
}>;

type ReviewFamilyContext = Readonly<{
  snapshot: FactSnapshot;
  generation: ScopedProjectionGeneration;
  pending: ReadonlyMap<FactActionId, FactAction>;
}>;

export type ReviewEffectEntry = Readonly<{
  identity: string;
  effect: DecisionEffect;
}>;

export type ReviewFamilyRule = Readonly<{
  key: string;
  actionKinds: readonly ProposableAction["kind"][];
  scopes(fact: FactAction, context: ReviewScopeContext): readonly string[];
  candidates(context: ReviewFamilyContext): readonly HunkCandidate[];
  effect(
    fact: FactAction,
    targets: readonly FactAction[],
    generation: ScopedProjectionGeneration,
  ): ReviewEffectEntry | null;
  addImpacts(impacts: Set<string>, targets: readonly FactAction[], generation: ScopedProjectionGeneration): void;
}>;
