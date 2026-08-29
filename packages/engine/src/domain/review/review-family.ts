import type { FactAction, FactActionId, FactSnapshot, ProposableAction, TextAtomId } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { DecisionEffect, ReviewHunk } from "./types.js";
import type { ReviewScopeContext } from "./review-scope.js";

export type HunkCandidate = Readonly<{
  diffSpace: ReviewHunk["diffSpace"];
  targets: readonly FactActionId[];
  bridges: readonly TextAtomId[];
}>;

type ReviewFamilyContext = Readonly<{
  snapshot: FactSnapshot;
  generation: InterpretedProjectionGeneration;
  pending: ReadonlyMap<FactActionId, FactAction>;
}>;

export type ReviewEffectEntry = Readonly<{
  identity: string;
  effect: DecisionEffect;
}>;

type ReviewAction<Kind extends ProposableAction["kind"]> = Extract<ProposableAction, { kind: Kind }>;
type ReviewFact<Kind extends ProposableAction["kind"]> = FactAction<ReviewAction<Kind>>;

export type ReviewFamilyRule<Kind extends ProposableAction["kind"] = ProposableAction["kind"]> = Readonly<{
  key: string;
  actionKinds: readonly Kind[];
  scopes(fact: ReviewFact<Kind>, context: ReviewScopeContext): readonly string[];
  candidates(context: ReviewFamilyContext): readonly HunkCandidate[];
  effect(
    fact: ReviewFact<Kind>,
    targets: readonly FactAction[],
    generation: InterpretedProjectionGeneration,
  ): ReviewEffectEntry | null;
  addImpacts(impacts: Set<string>, targets: readonly FactAction[], generation: InterpretedProjectionGeneration): void;
}>;
