import {
  canonicalJson,
  compareCausalOrder,
  type FactAction,
  type FactActionId,
  type FactSnapshot,
  type ProposableAction,
  type TextAtomId,
} from "../fact/index.js";
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
export type ReviewFact<Kind extends ProposableAction["kind"]> = FactAction<ReviewAction<Kind>>;

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

type DiffSpaceKind = ReviewHunk["diffSpace"]["kind"];

/**
 * A family whose review unit is a projection identity: pending facts group by that identity, a
 * group surfaces only when its effect differs between the Origin and Review perspectives, and the
 * hunk targets are the group in causal order. Families with a different review unit (text
 * clustering, structure region merging, per-occurrence fan-out) implement ReviewFamilyRule
 * directly.
 */
type IdentityReviewFamilyConfig<
  Kind extends ProposableAction["kind"],
  Identity extends string,
  Effect extends DecisionEffect,
> = Readonly<{
  key: string;
  actionKinds: readonly Kind[];
  scopes: ReviewFamilyRule<Kind>["scopes"];
  /** Group key and diff-space identity; null exempts the fact from candidate grouping. */
  identify(fact: ReviewFact<Kind>, generation: InterpretedProjectionGeneration): Identity | null;
  /** Effect for a group; must depend only on the identity (all group members agree on it). */
  effect(fact: ReviewFact<Kind>, identity: Identity, generation: InterpretedProjectionGeneration): Effect;
  changed(effect: Effect): boolean;
  diffKind: DiffSpaceKind | ((effect: Effect) => DiffSpaceKind);
  effectIdentity(identity: Identity, effect: Effect): string;
  addImpacts: ReviewFamilyRule<Kind>["addImpacts"];
}>;

export function defineReviewFamily<
  Kind extends ProposableAction["kind"],
  Identity extends string,
  Effect extends DecisionEffect,
>(config: IdentityReviewFamilyConfig<Kind, Identity, Effect>): ReviewFamilyRule<Kind> {
  const kinds: ReadonlySet<string> = new Set(config.actionKinds);
  const owns = (fact: FactAction): fact is ReviewFact<Kind> => kinds.has(fact.action.kind);
  const diffKindFor = (effect: Effect): DiffSpaceKind =>
    typeof config.diffKind === "function" ? config.diffKind(effect) : config.diffKind;
  return {
    key: config.key,
    actionKinds: config.actionKinds,
    scopes: config.scopes,
    candidates({ generation, pending }) {
      const groups = new Map<Identity, ReviewFact<Kind>[]>();
      for (const fact of pending.values()) {
        if (!owns(fact)) {
          continue;
        }
        const identity = config.identify(fact, generation);
        if (identity === null) {
          continue;
        }
        const group = groups.get(identity) ?? [];
        group.push(fact);
        groups.set(identity, group);
      }
      return [...groups].flatMap(([identity, facts]): readonly HunkCandidate[] => {
        const [representative] = facts;
        if (!representative) {
          return [];
        }
        const effect = config.effect(representative, identity, generation);
        return config.changed(effect)
          ? [
              {
                diffSpace: { kind: diffKindFor(effect), identity },
                targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
                bridges: [],
              },
            ]
          : [];
      });
    },
    effect(fact, _targets, generation) {
      const identity = config.identify(fact, generation);
      if (identity === null) {
        return null;
      }
      const effect = config.effect(fact, identity, generation);
      return config.changed(effect) ? { identity: config.effectIdentity(identity, effect), effect } : null;
    },
    addImpacts: config.addImpacts,
  };
}

export function originReviewChanged(effect: Readonly<{ origin: unknown; review: unknown }>): boolean {
  return canonicalJson(effect.origin) !== canonicalJson(effect.review);
}
