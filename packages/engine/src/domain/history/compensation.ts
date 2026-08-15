import { canonicalJson, type ContributionFact, type FactSnapshot, type Mutation } from "../fact/index.js";
import { rebuildGeneration, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { deriveActivation } from "../activation/index.js";
import { normalizeCompensationTargets } from "./compensation-normalization.js";
import { compensateMutation } from "./compensation-rules.js";
import { scopedHistoryFacts } from "./compensation-scope.js";

export type Compensation =
  | Readonly<{ kind: "ready"; mutations: readonly Mutation[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;

export function planCompensation(
  targetFacts: readonly ContributionFact[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): Compensation {
  const intent = targetFacts[0]?.body.intent;
  if (!intent || targetFacts.some((fact) => fact.body.intent !== intent)) {
    return { kind: "stale", reason: "History Step has inconsistent editing intent" };
  }
  const scopedFacts = scopedHistoryFacts(snapshot.facts, targetFacts, generation.review);
  const reviewActivation = deriveActivation(scopedFacts, "review");
  const eligibleTargets =
    intent === "proposal"
      ? targetFacts.filter((fact) => !reviewActivation.resolutionByContribution.has(fact.id))
      : [...targetFacts];
  if (eligibleTargets.length === 0) {
    return { kind: "unavailable", reason: "Terminal Proposal Contributions are not undoable" };
  }

  const originActivation = deriveActivation(scopedFacts, "origin");
  const contingentDirect =
    intent === "direct" &&
    eligibleTargets.some(
      (fact) =>
        reviewActivation.activeContributionIds.has(fact.id) && !originActivation.activeContributionIds.has(fact.id),
    );
  const view = intent === "proposal" || contingentDirect ? "review" : "origin";
  const projection = generation[view];
  const active = view === "review" ? reviewActivation : originActivation;
  const eligibleIds = new Set(eligibleTargets.map((fact) => fact.id));
  const counterfactualFacts = scopedFacts.filter((fact) => !eligibleIds.has(fact.id));
  const firstTarget = eligibleTargets[0];
  if (!firstTarget) {
    return { kind: "unavailable", reason: "History Step has no target Facts" };
  }
  const versions = {
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
  const scoped = rebuildGeneration(
    firstTarget.workspaceId,
    { facts: scopedFacts, frontier: snapshot.frontier },
    versions,
  ).generation[view];
  const counterfactual = rebuildGeneration(
    firstTarget.workspaceId,
    { facts: counterfactualFacts, frontier: snapshot.frontier },
    versions,
  ).generation[view];
  if (canonicalJson(scoped) === canonicalJson(counterfactual)) {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }

  const normalizedTargets = normalizeCompensationTargets(eligibleTargets, projection);
  const normalizedIds = new Set(normalizedTargets.map((fact) => fact.id));
  const activeFacts = scopedFacts.filter(
    (fact): fact is ContributionFact =>
      fact.body.kind === "contribution" &&
      active.activeContributionIds.has(fact.id) &&
      (!eligibleIds.has(fact.id) || normalizedIds.has(fact.id)),
  );
  const mutations: Mutation[] = [];
  for (const target of [...normalizedTargets].reverse()) {
    if (!active.activeContributionIds.has(target.id)) {
      continue;
    }
    const planned = compensateMutation(target, eligibleIds, activeFacts, projection);
    if (planned.kind === "stale") {
      return planned;
    }
    mutations.push(...planned.mutations);
  }
  return mutations.length === 0
    ? { kind: "unavailable", reason: "History Step has no attributable effect" }
    : { kind: "ready", mutations };
}
