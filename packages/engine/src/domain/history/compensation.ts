import {
  canonicalJson,
  factActionsFromFacts,
  isTextAction,
  type Fact,
  type FactAction,
  type FactSnapshot,
  type GraphAction,
} from "../fact/index.js";
import { deriveActivation, resolutionsByAction } from "../activation/index.js";
import { rebuildGeneration, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import { normalizeCompensationTargets } from "./compensation-normalization.js";
import { compensateAction, isCompensationTargetAction } from "./compensation-plan.js";
import { fieldDefinitionConfigurationCompensations } from "./compensation-field-definition.js";
import type { CompensationBatch } from "./types.js";
import type { CompensationTargetAction, ContentRestoration } from "./compensation-types.js";
import { neutralizedLaterFacts } from "./counterfactual.js";
import { contentAttribution } from "./content-attribution.js";
import { composeContentRestorations } from "./content-restoration.js";

type Compensation =
  | Readonly<{ kind: "ready"; actions: readonly GraphAction[]; restorations: readonly ContentRestoration[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;

type InvocationCompensation =
  | Readonly<{ kind: "ready"; writes: readonly CompensationBatch[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;

export function planInvocationCompensation(
  targetFacts: readonly Fact[],
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
): InvocationCompensation {
  if (targetFacts.some((fact) => fact.body.kind !== "action")) {
    return { kind: "stale", reason: "History Step contains a non-Action Fact" };
  }
  const neutralized = neutralizedLaterFacts(targetFacts, snapshot);
  const attribution = contentAttribution(snapshot, neutralized);
  const compensation = planCompensation(
    factActionsFromFacts(targetFacts),
    snapshot,
    generation,
    neutralized,
    attribution,
  );
  if (compensation.kind !== "ready") {
    return compensation;
  }
  const intent = targetFacts[0]?.body;
  const [first, ...rest] = compensation.actions;
  if (!first || intent?.kind !== "action") {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }
  return {
    kind: "ready",
    writes: [
      {
        intent: intent.intent,
        actions: [first, ...rest],
        restorations: compensation.restorations.map((item) => ({
          actionIndex: compensation.actions.indexOf(item.action),
          sources: item.sources,
        })),
      },
    ],
  };
}
function planCompensation(
  targetFacts: readonly FactAction[],
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
  neutralized: ReadonlySet<string>,
  attribution: ReturnType<typeof contentAttribution>,
): Compensation {
  const intent = targetFacts[0]?.intent;
  if (!intent || targetFacts.some((fact) => fact.intent !== intent)) {
    return { kind: "stale", reason: "History Step has inconsistent editing intent" };
  }
  const compensationTargets = targetFacts.filter((fact): fact is FactAction<CompensationTargetAction> =>
    isCompensationTargetAction(fact.action),
  );
  if (compensationTargets.length !== targetFacts.length) {
    return { kind: "unavailable", reason: "Direct-only Action Facts are not undoable" };
  }
  const resolutions = resolutionsByAction(snapshot.facts);
  const eligibleTargets =
    intent === "proposal" ? compensationTargets.filter((fact) => !resolutions.has(fact.id)) : [...compensationTargets];
  if (eligibleTargets.length === 0) {
    return { kind: "unavailable", reason: "Resolved Proposal Fact actions are not undoable" };
  }
  const eligibleIds = new Set(eligibleTargets.map((fact) => fact.id));
  const excludedFactIds = new Set(eligibleTargets.map((fact) => fact.factId));
  const counterfactualFacts = snapshot.facts
    .filter((fact) => !excludedFactIds.has(fact.id) && !neutralized.has(fact.id))
    .map((fact) => attribution.fact(fact));
  const firstTarget = eligibleTargets[0];
  if (!firstTarget) {
    return { kind: "unavailable", reason: "History Step has no target Facts" };
  }
  const versions = {
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
  const originActive = deriveActivation(snapshot.facts, "origin").activeActionIds;
  const reviewActive = deriveActivation(snapshot.facts, "review").activeActionIds;
  const contingentDirect =
    intent === "direct" && eligibleTargets.some((fact) => reviewActive.has(fact.id) && !originActive.has(fact.id));
  const perspective = intent === "proposal" || contingentDirect ? "review" : "origin";
  const projection = attribution.projection(generation[perspective]);
  const active = perspective === "review" ? reviewActive : originActive;
  const scoped = projection;
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
  const activeFacts = factActionsFromFacts(snapshot.facts)
    .filter(
      (fact) =>
        active.has(fact.id) &&
        !neutralized.has(fact.factId) &&
        (!eligibleIds.has(fact.id) || normalizedIds.has(fact.id)),
    )
    .map((fact) => attribution.action(fact));
  const actions: GraphAction[] = [];
  const restorations: ContentRestoration[] = [];
  for (const target of [...normalizedTargets].reverse()) {
    if (!active.has(target.id)) {
      continue;
    }
    const planned = compensateAction(attribution.action(target) as typeof target, {
      targetIds: eligibleIds,
      activeFacts,
      projection,
      counterfactual,
    });
    if (planned.kind === "stale") {
      return planned;
    }
    actions.push(...planned.actions);
    restorations.push(...(planned.restorations ?? []));
  }
  actions.unshift(...fieldDefinitionConfigurationCompensations(scoped, counterfactual, actions));
  actions.unshift(...typedFieldValueCompensations(projection, actions));
  if (actions.length === 0) {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }
  const composed = composeContentRestorations(actions, restorations, projection, counterfactual);
  if (composed.kind === "stale") {
    return composed;
  }
  const outputs = new Map(composed.actions.map((action) => [action, attribution.output(action)]));
  return {
    kind: "ready",
    actions: [...outputs.values()],
    restorations: (composed.restorations ?? []).map((item) => ({ ...item, action: outputs.get(item.action)! })),
  };
}

function typedFieldValueCompensations(
  projection: InterpretedProjectionGeneration["origin"],
  planned: readonly GraphAction[],
): readonly GraphAction[] {
  const result: GraphAction[] = [];
  for (const [ownerNodeId, fields] of Object.entries(projection.typedFieldValues)) {
    for (const field of fields) {
      if (
        field.state !== "value" ||
        (field.value.kind !== "number" && field.value.kind !== "date") ||
        !planned.some(
          (authoredAction) => isTextAction(authoredAction) && authoredAction.nodeId === field.value.valueNodeId,
        ) ||
        planned.some(
          (authoredAction) =>
            authoredAction.kind === "field-materialize" &&
            authoredAction.ownerNodeId === ownerNodeId &&
            authoredAction.fieldDefinitionId === field.fieldDefinitionId,
        )
      ) {
        continue;
      }
      result.push({
        kind: "field-materialize",
        ownerNodeId,
        fieldDefinitionId: field.fieldDefinitionId,
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
