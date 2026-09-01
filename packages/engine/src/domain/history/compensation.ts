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
import type { CompensationTargetAction } from "./compensation-types.js";

type Compensation =
  | Readonly<{ kind: "ready"; actions: readonly GraphAction[] }>
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
  let remainingFacts = snapshot.facts;
  let remainingGeneration = generation;
  const writes: CompensationBatch[] = [];
  const versions = {
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };

  for (const target of [...targetFacts].reverse()) {
    if (target.body.kind !== "action") {
      return { kind: "stale", reason: "History Step contains a non-Action Fact" };
    }
    const currentSnapshot = { facts: remainingFacts, frontier: snapshot.frontier };
    const compensation = planCompensation(factActionsFromFacts([target]), currentSnapshot, remainingGeneration);
    if (compensation.kind === "stale") {
      return compensation;
    }
    if (compensation.kind === "ready") {
      const [first, ...rest] = compensation.actions;
      if (first) {
        writes.push({ intent: target.body.intent, actions: [first, ...rest] });
      }
      remainingFacts = remainingFacts.filter((fact) => fact.id !== target.id);
      remainingGeneration = rebuildGeneration(
        generation.identity.workspaceNodeId,
        { facts: remainingFacts, frontier: snapshot.frontier },
        versions,
      );
    }
  }

  return writes.length === 0
    ? { kind: "unavailable", reason: "History Step has no attributable effect" }
    : { kind: "ready", writes };
}

function planCompensation(
  targetFacts: readonly FactAction[],
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
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
  const counterfactualFacts = snapshot.facts.filter((fact) => !excludedFactIds.has(fact.id));
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
  const projection = generation[perspective];
  const active = perspective === "review" ? reviewActive : originActive;
  const scoped = generation[perspective];
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
  const activeFacts = factActionsFromFacts(snapshot.facts).filter(
    (fact) => active.has(fact.id) && (!eligibleIds.has(fact.id) || normalizedIds.has(fact.id)),
  );
  const actions: GraphAction[] = [];
  for (const target of [...normalizedTargets].reverse()) {
    if (!active.has(target.id)) {
      continue;
    }
    const planned = compensateAction(target, {
      targetIds: eligibleIds,
      activeFacts,
      projection,
      counterfactual,
    });
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
