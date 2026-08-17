import {
  canonicalJson,
  detachedViewValueNodeId,
  detachedViewValueOccurrenceId,
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
} from "../fact/index.js";
import { rebuildGeneration, type ScopedProjectionGeneration } from "../reconcile/index.js";
import { insertAtAnchor } from "../reconcile/sequence.js";
import { deriveActivation } from "../activation/index.js";
import { normalizeCompensationTargets } from "./compensation-normalization.js";
import { compensateMutation } from "./compensation-rules.js";
import { scopedHistoryFacts } from "./compensation-scope.js";
import { fieldDefinitionConfigurationCompensations } from "./compensation-field-definition.js";

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
  const perspective = intent === "proposal" || contingentDirect ? "review" : "origin";
  const projection = generation[perspective];
  const active = perspective === "review" ? reviewActivation : originActivation;
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
  ).generation[perspective];
  const counterfactual = rebuildGeneration(
    firstTarget.workspaceId,
    { facts: counterfactualFacts, frontier: snapshot.frontier },
    versions,
  ).generation[perspective];
  if (canonicalJson(scoped) === canonicalJson(counterfactual)) {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }

  const creationPlacementIds = nodeCreationPlacementIds(eligibleTargets);
  const infrastructureNodeCreationIds = semanticInfrastructureNodeCreationIds(eligibleTargets);
  const normalizedTargets = normalizeCompensationTargets(eligibleTargets, projection).filter(
    (fact) => !creationPlacementIds.has(fact.id) && !infrastructureNodeCreationIds.has(fact.id),
  );
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
  mutations.unshift(...fieldDefinitionConfigurationCompensations(scoped, counterfactual, mutations));
  mutations.unshift(...viewDefinitionLifecycleCompensations(scoped, counterfactual, mutations));
  mutations.unshift(...typedFieldValueCompensations(projection, mutations));
  return mutations.length === 0
    ? { kind: "unavailable", reason: "History Step has no attributable effect" }
    : { kind: "ready", mutations: normalizeOccurrenceStructureEvidence(mutations, projection) };
}

function typedFieldValueCompensations(
  projection: ScopedProjectionGeneration["origin"],
  planned: readonly Mutation[],
): readonly Mutation[] {
  const result: Mutation[] = [];
  for (const [ownerNodeId, fields] of Object.entries(projection.typedFieldValues)) {
    for (const field of fields) {
      if (
        field.state !== "value" ||
        (field.value.kind !== "number" && field.value.kind !== "date") ||
        !planned.some(
          (mutation) =>
            (mutation.kind === "text-splice" || mutation.kind === "text-mark") &&
            mutation.nodeId === field.value.valueNodeId,
        ) ||
        planned.some(
          (mutation) =>
            mutation.kind === "field-materialize" &&
            mutation.ownerNodeId === ownerNodeId &&
            mutation.fieldDefinitionId === field.fieldDefinitionId &&
            mutation.fieldNodeId === field.fieldNodeId,
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

function viewDefinitionLifecycleCompensations(
  current: ScopedProjectionGeneration["origin"],
  counterfactual: ScopedProjectionGeneration["origin"],
  planned: readonly Mutation[],
): readonly Mutation[] {
  const result: Mutation[] = [];
  const counterfactualAttachments = new Set(
    Object.values(counterfactual.sharedDefaultViewDefinitions)
      .flat()
      .map((definition) => definition.attachmentNodeId),
  );
  for (const definitions of Object.values(current.sharedDefaultViewDefinitions)) {
    for (const definition of definitions) {
      const detachedValueNodeId = detachedViewValueNodeId(definition.attachmentNodeId);
      if (
        counterfactualAttachments.has(definition.attachmentNodeId) ||
        !planned.some((mutation) => mutation.kind === "node-restore" && mutation.nodeId === detachedValueNodeId) ||
        planned.some(
          (mutation) =>
            mutation.kind === "shared-default-view-definition-detach" &&
            mutation.attachmentNodeId === definition.attachmentNodeId,
        )
      ) {
        continue;
      }
      result.push({
        kind: "shared-default-view-definition-detach",
        hostNodeId: definition.hostNodeId,
        attachmentNodeId: definition.attachmentNodeId,
        attachmentOccurrenceId: definition.attachmentOccurrenceId,
        relationDefinitionOccurrenceId: definition.relationDefinitionOccurrenceId,
        viewDefinitionNodeId: definition.viewDefinitionNodeId,
        viewDefinitionOccurrenceId: definition.viewDefinitionOccurrenceId,
        detachedValueNodeId,
        detachedValueOccurrenceId: detachedViewValueOccurrenceId(definition.attachmentNodeId),
      });
    }
  }
  return result;
}

function normalizeOccurrenceStructureEvidence(
  mutations: readonly Mutation[],
  projection: ScopedProjectionGeneration["origin"],
): readonly Mutation[] {
  const occurrences = new Map(Object.entries(projection.occurrences));
  const children = new Map(
    Object.entries(projection.childOccurrences).map(([parentNodeId, occurrenceIds]) => [
      parentNodeId,
      [...occurrenceIds],
    ]),
  );
  return mutations.map((mutation): Mutation => {
    if (mutation.kind !== "occurrence-delete" && mutation.kind !== "occurrence-move") {
      if (mutation.kind === "occurrence-create" || mutation.kind === "occurrence-restore") {
        const siblings = children.get(mutation.parentNodeId) ?? [];
        insertAtAnchor(siblings, mutation.occurrenceId, mutation.anchor);
        children.set(mutation.parentNodeId, siblings);
      }
      if (mutation.kind === "occurrence-create") {
        occurrences.set(mutation.occurrenceId, {
          occurrenceId: mutation.occurrenceId,
          nodeId: mutation.nodeId,
          parentNodeId: mutation.parentNodeId,
          derived: false,
        });
      }
      return mutation;
    }
    const occurrence = occurrences.get(mutation.occurrenceId);
    if (!occurrence) {
      return mutation;
    }
    const siblings = children.get(occurrence.parentNodeId) ?? [];
    const index = siblings.indexOf(mutation.occurrenceId);
    if (index < 0) {
      return mutation;
    }
    const previousAnchor = {
      after: index > 0 ? (siblings[index - 1] ?? null) : null,
      before: index + 1 < siblings.length ? (siblings[index + 1] ?? null) : null,
      affinity: "after" as const,
      fallback: index === 0 ? ("start" as const) : ("end" as const),
    };
    siblings.splice(index, 1);
    children.set(occurrence.parentNodeId, siblings);
    const prepared = {
      ...mutation,
      previousParentNodeId: occurrence.parentNodeId,
      previousAnchor,
    };
    if (mutation.kind === "occurrence-delete") {
      occurrences.delete(mutation.occurrenceId);
      return prepared;
    }
    const destination = children.get(mutation.parentNodeId) ?? [];
    insertAtAnchor(destination, mutation.occurrenceId, mutation.anchor);
    children.set(mutation.parentNodeId, destination);
    occurrences.set(mutation.occurrenceId, { ...occurrence, parentNodeId: mutation.parentNodeId });
    return prepared;
  });
}

function semanticInfrastructureNodeCreationIds(targets: readonly ContributionFact[]): ReadonlySet<string> {
  const hiddenNodeIds = new Set(
    targets.flatMap((fact) => (fact.body.mutation.kind === "metanode-attach" ? [fact.body.mutation.metanodeId] : [])),
  );
  targets.forEach((fact) => {
    if (fact.body.mutation.kind === "inline-reference-alias-attach") {
      hiddenNodeIds.add(fact.body.mutation.aliasNodeId);
    } else if (fact.body.mutation.kind === "shared-default-view-definition-detach") {
      hiddenNodeIds.add(fact.body.mutation.detachedValueNodeId);
    }
  });
  return new Set(
    targets.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return (mutation.kind === "node-create" && hiddenNodeIds.has(mutation.nodeId)) ||
        (mutation.kind === "node-owner-set" &&
          mutation.previousOwnerNodeId === null &&
          hiddenNodeIds.has(mutation.nodeId))
        ? [fact.id]
        : [];
    }),
  );
}

function nodeCreationPlacementIds(targets: readonly ContributionFact[]): ReadonlySet<string> {
  const transactionNodeIds = new Set(
    targets.flatMap((fact) =>
      fact.body.mutation.kind === "node-create"
        ? [`${fact.transaction.transactionId}/${fact.body.mutation.nodeId}`]
        : [],
    ),
  );
  return new Set(
    targets.flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-create" &&
      transactionNodeIds.has(`${fact.transaction.transactionId}/${fact.body.mutation.nodeId}`)
        ? [fact.id]
        : [],
    ),
  );
}
