import {
  canonicalJson,
  factActionsFromFacts,
  type FactAction,
  type FactSnapshot,
  type AuthoredAction,
} from "../fact/index.js";
import { resolutionsByAction } from "../activation/index.js";
import { rebuildGeneration, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { normalizeCompensationTargets } from "./compensation-normalization.js";
import { compensateAction } from "./compensation-rules.js";
import { scopedHistoryFacts } from "./compensation-scope.js";
import { fieldDefinitionConfigurationCompensations } from "./compensation-field-definition.js";

export type Compensation =
  | Readonly<{ kind: "ready"; actions: readonly AuthoredAction[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;

export function planCompensation(
  targetFacts: readonly FactAction[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  inverseHints: readonly AuthoredAction[] = [],
): Compensation {
  const intent = targetFacts[0]?.intent;
  if (!intent || targetFacts.some((fact) => fact.intent !== intent)) {
    return { kind: "stale", reason: "History Step has inconsistent editing intent" };
  }
  const scopedFacts = scopedHistoryFacts(snapshot.facts, targetFacts, generation.review);
  const resolutions = resolutionsByAction(scopedFacts);
  const eligibleTargets =
    intent === "proposal" ? targetFacts.filter((fact) => !resolutions.has(fact.id)) : [...targetFacts];
  if (eligibleTargets.length === 0) {
    return { kind: "unavailable", reason: "Resolved Proposal Fact actions are not undoable" };
  }
  const eligibleIds = new Set(eligibleTargets.map((fact) => fact.id));
  const excludedFactIds = new Set(eligibleTargets.map((fact) => fact.factId));
  const counterfactualFacts = scopedFacts.filter((fact) => !excludedFactIds.has(fact.id));
  const firstTarget = eligibleTargets[0];
  if (!firstTarget) {
    return { kind: "unavailable", reason: "History Step has no target Facts" };
  }
  const versions = {
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
  const currentGeneration = rebuildGeneration(
    generation.identity.workspaceNodeId,
    { facts: scopedFacts, frontier: snapshot.frontier },
    versions,
  );
  const originActive = new Set(currentGeneration.planCaches.origin.activeActionIds);
  const reviewActive = new Set(currentGeneration.planCaches.review.activeActionIds);
  const contingentDirect =
    intent === "direct" && eligibleTargets.some((fact) => reviewActive.has(fact.id) && !originActive.has(fact.id));
  const perspective = intent === "proposal" || contingentDirect ? "review" : "origin";
  const projection = generation[perspective];
  const active = perspective === "review" ? reviewActive : originActive;
  const scoped = currentGeneration[perspective];
  const counterfactual = rebuildGeneration(
    generation.identity.workspaceNodeId,
    { facts: counterfactualFacts, frontier: snapshot.frontier },
    versions,
  )[perspective];
  if (canonicalJson(scoped) === canonicalJson(counterfactual)) {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }

  const infrastructureNodeCreationIds = semanticInfrastructureNodeCreationIds(eligibleTargets);
  const normalizedTargets = normalizeCompensationTargets(eligibleTargets, projection).filter(
    (fact) => !infrastructureNodeCreationIds.has(fact.id),
  );
  const normalizedIds = new Set(normalizedTargets.map((fact) => fact.id));
  const activeFacts = factActionsFromFacts(scopedFacts).filter(
    (fact) => active.has(fact.id) && (!eligibleIds.has(fact.id) || normalizedIds.has(fact.id)),
  );
  const actions: AuthoredAction[] = [];
  for (const target of [...normalizedTargets].reverse()) {
    if (!active.has(target.id)) {
      continue;
    }
    const planned = compensateAction(target, eligibleIds, activeFacts, projection, counterfactual, inverseHints);
    if (planned.kind === "stale") {
      return planned;
    }
    actions.push(...planned.actions);
  }
  actions.unshift(...fieldDefinitionConfigurationCompensations(scoped, counterfactual, actions));
  actions.unshift(...typedFieldValueCompensations(projection, actions));
  return actions.length === 0
    ? { kind: "unavailable", reason: "History Step has no attributable effect" }
    : { kind: "ready", actions };
}

function typedFieldValueCompensations(
  projection: ScopedProjectionGeneration["origin"],
  planned: readonly AuthoredAction[],
): readonly AuthoredAction[] {
  const result: AuthoredAction[] = [];
  for (const [ownerNodeId, fields] of Object.entries(projection.typedFieldValues)) {
    for (const field of fields) {
      if (
        field.state !== "value" ||
        (field.value.kind !== "number" && field.value.kind !== "date") ||
        !planned.some(
          (authoredAction) =>
            (authoredAction.kind === "rich-text-splice" || authoredAction.kind === "rich-text-mark") &&
            authoredAction.nodeId === field.value.valueNodeId,
        ) ||
        planned.some(
          (authoredAction) =>
            authoredAction.kind === "field-materialize" &&
            authoredAction.ownerNodeId === ownerNodeId &&
            authoredAction.fieldDefinitionId === field.fieldDefinitionId &&
            authoredAction.fieldNodeId === field.fieldNodeId,
        )
      ) {
        continue;
      }
      result.push({
        kind: "field-materialize",
        ownerNodeId,
        fieldDefinitionId: field.fieldDefinitionId,
        fieldNodeId: field.fieldNodeId,
        fieldOccurrenceId: field.fieldOccurrenceId,
      });
    }
  }
  return result;
}

function semanticInfrastructureNodeCreationIds(targets: readonly FactAction[]): ReadonlySet<string> {
  const hiddenNodeIds = new Set<string>();
  targets.forEach((fact) => {
    if (fact.action.kind === "inline-alias-attach") {
      hiddenNodeIds.add(fact.action.aliasNodeId);
    }
  });
  return new Set(
    targets.flatMap((fact) => {
      const authoredAction = fact.action;
      return authoredAction.kind === "node-create" && hiddenNodeIds.has(authoredAction.nodeId) ? [fact.id] : [];
    }),
  );
}
