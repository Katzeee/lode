import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  templateInstanceNodeId,
  type ContributionFact,
  type FactSnapshot,
} from "../fact/index.js";
import { type Projection, type ProjectionGeneration } from "../reconcile/index.js";
import { deriveActivation } from "../reconcile/support.js";
import { associatedImpacts, mutationAnchor, structureEffect } from "./impacts.js";
import type { DecisionEffect, DecisionEvidence, TextDecisionEffect } from "./types.js";
import { fieldMaterializationEffect, schemaRelationEffect } from "./schema-review.js";
import { fieldConfigurationEffect } from "./schema-candidates.js";
import { generatedOperationTargets } from "./generated-operation-targets.js";
import { valueAddress, valueEffect, valueState } from "./value-effect.js";

export { valueAddress } from "./value-effect.js";
export function evidenceForTargets(
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  targetIds: readonly string[],
  context = createReviewEvidenceContext(snapshot),
): DecisionEvidence | null {
  const pending = context.pending;
  const expandedTargetIds = proposalClosure(
    generatedOperationTargets(targetIds, pending, context.supportByContribution),
    pending,
  );
  const targets = expandedTargetIds
    .map((id) => pending.get(id))
    .filter((fact): fact is ContributionFact => fact !== undefined)
    .sort(compareFacts);
  if (targets.length !== expandedTargetIds.length) {
    return null;
  }
  const closure = proposalClosure(
    targets.map((fact) => fact.id),
    pending,
    context.supportByContribution,
  );
  const effects = normalizedEffects(targets, generation);
  if (effects.length === 0) {
    return null;
  }
  return {
    proposalTargets: targets.map((fact) => fact.id).sort(stableStringCompare),
    supportClosure: closure,
    effects,
    associatedImpactIds: associatedImpacts(targets, generation),
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
}

function proposalClosure(
  targetIds: readonly string[],
  pending: ReadonlyMap<string, ContributionFact>,
  supportByContribution?: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const transactionMembers = new Map<string, string[]>();
  for (const fact of pending.values()) {
    const members = transactionMembers.get(fact.transaction.transactionId) ?? [];
    members.push(fact.id);
    transactionMembers.set(fact.transaction.transactionId, members);
  }
  const closure = new Set<string>();
  const queue = [...targetIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const fact = pending.get(id);
    if (!fact || closure.has(id)) {
      continue;
    }
    closure.add(id);
    queue.push(...(transactionMembers.get(fact.transaction.transactionId) ?? []));
    queue.push(...(supportByContribution?.get(id) ?? []));
  }
  return [...closure].sort(stableStringCompare);
}
export type ReviewEvidenceContext = Readonly<{
  pending: ReadonlyMap<string, ContributionFact>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
}>;
export function createReviewEvidenceContext(snapshot: FactSnapshot): ReviewEvidenceContext {
  const origin = deriveActivation(snapshot.facts, "origin");
  const review = deriveActivation(snapshot.facts, "review");
  const pending = new Map(
    snapshot.facts
      .filter(
        (fact): fact is ContributionFact =>
          fact.body.kind === "contribution" &&
          fact.body.intent === "proposal" &&
          review.activeContributionIds.has(fact.id) &&
          !origin.activeContributionIds.has(fact.id),
      )
      .map((fact) => [fact.id, fact]),
  );
  return { pending, supportByContribution: review.supportByContribution };
}

export function pendingProposalFacts(
  snapshot: FactSnapshot,
): ReadonlyMap<string, ContributionFact> {
  return createReviewEvidenceContext(snapshot).pending;
}

export function normalizedEffects(
  targets: readonly ContributionFact[],
  generation: ProjectionGeneration,
): readonly DecisionEffect[] {
  const effects = new Map<string, DecisionEffect>();
  for (const fact of targets) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "text-splice" || mutation.kind === "text-mark") {
      if (effects.has(`text/${mutation.nodeId}`)) {
        continue;
      }
      const textTargets = targets.filter(
        (target) =>
          (target.body.mutation.kind === "text-splice" ||
            target.body.mutation.kind === "text-mark") &&
          target.body.mutation.nodeId === mutation.nodeId,
      );
      const effect = textEffect(mutation.nodeId, textTargets, generation);
      if (effect.addedAtomIds.length || effect.deletedAtomIds.length || effect.markChanges.length) {
        effects.set(`text/${mutation.nodeId}`, effect);
      }
    } else if (
      mutation.kind === "occurrence-create" ||
      mutation.kind === "occurrence-delete" ||
      mutation.kind === "occurrence-restore" ||
      mutation.kind === "occurrence-move" ||
      mutation.kind === "field-value-delete"
    ) {
      const occurrenceId =
        mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : mutation.occurrenceId;
      const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
      if (
        canonicalJson([effect.originPresent, effect.originParentId, effect.originRelation]) !==
        canonicalJson([effect.reviewPresent, effect.reviewParentId, effect.reviewRelation])
      ) {
        effects.set(`structure/${occurrenceId}`, effect);
      }
    } else if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      const effect = valueEffect(mutation, generation);
      if (canonicalJson(effect.origin) !== canonicalJson(effect.review)) {
        effects.set(`value/${valueAddress(mutation)}`, effect);
      }
    } else if (mutation.kind === "schema-field-configure") {
      const effect = fieldConfigurationEffect(fact, generation);
      if (canonicalJson(effect.origin) !== canonicalJson(effect.review)) {
        effects.set(
          canonicalJson(["field-configuration", effect.schemaId, effect.fieldDefinitionId]),
          effect,
        );
      }
    } else if (mutation.kind.startsWith("schema-")) {
      const effect = schemaRelationEffect(fact, generation);
      if (effect.originIndex !== effect.reviewIndex) {
        effects.set(
          canonicalJson(["schema-relation", effect.relation, effect.ownerId, effect.targetId]),
          effect,
        );
      }
    } else if (
      mutation.kind === "field-materialize" ||
      mutation.kind === "field-initialize" ||
      mutation.kind === "materialized-field-delete"
    ) {
      const effect = fieldMaterializationEffect(fact, generation);
      if (effect.originFieldNodeId !== effect.reviewFieldNodeId) {
        effects.set(
          canonicalJson(["field-materialization", effect.ownerNodeId, effect.fieldDefinitionId]),
          effect,
        );
      }
    } else if (mutation.kind === "node-owner-set") {
      const origin = generation.origin.nodeOwners[mutation.nodeId] ?? null;
      const review = generation.review.nodeOwners[mutation.nodeId] ?? null;
      if (origin !== review) {
        effects.set(`owner/${mutation.nodeId}`, {
          kind: "owner",
          identity: mutation.nodeId,
          origin,
          review,
        });
      }
    } else {
      const identity = mutationIdentity(fact);
      const origin = lifecycleVisible(identity, mutation.kind, generation.origin);
      const review = lifecycleVisible(identity, mutation.kind, generation.review);
      if (origin !== review) {
        effects.set(`lifecycle/${identity}`, { kind: "lifecycle", identity, origin, review });
      }
    }
  }
  return [...effects.values()].sort((left, right) =>
    stableStringCompare(canonicalJson(left), canonicalJson(right)),
  );
}

export function mutationIdentity(fact: ContributionFact): string {
  const mutation = fact.body.mutation;
  if ("nodeId" in mutation) {
    return mutation.nodeId;
  }
  if ("occurrenceId" in mutation) {
    return mutation.occurrenceId;
  }
  if (mutation.kind === "template-node-detach") {
    return templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId);
  }
  if (mutation.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  if (mutation.kind === "materialized-field-delete") {
    return mutation.fieldNodeId;
  }
  return fact.id;
}

function textEffect(
  nodeId: string,
  targets: readonly ContributionFact[],
  generation: ProjectionGeneration,
): TextDecisionEffect {
  const origin = generation.origin.nodes[nodeId]?.text ?? [];
  const review = generation.review.nodes[nodeId]?.text ?? [];
  const originById = new Map(origin.map((atom) => [atom.id, atom]));
  const reviewById = new Map(review.map((atom) => [atom.id, atom]));
  const targetIds = new Set(targets.map((target) => target.id));
  const targetDeletedIds = new Set(
    targets.flatMap((target) =>
      target.body.mutation.kind === "text-splice" ? target.body.mutation.deleteAtomIds : [],
    ),
  );
  const targetMarks = new Set(
    targets.flatMap((target) => {
      const mutation = target.body.mutation;
      return mutation.kind === "text-mark"
        ? mutation.atomIds.map((atomId) => `${atomId}/${mutation.key}`)
        : [];
    }),
  );
  const addedAtomIds = review
    .filter((atom) => !originById.has(atom.id) && targetIds.has(atom.contributionId))
    .map((atom) => atom.id);
  const deletedAtomIds = origin
    .filter((atom) => !reviewById.has(atom.id) && targetDeletedIds.has(atom.id))
    .map((atom) => atom.id);
  const markChanges = [...originById]
    .filter(([id]) => reviewById.has(id))
    .flatMap(([id, originAtom]) => {
      const reviewAtom = reviewById.get(id)!;
      const keys = new Set([
        ...Object.keys(originAtom.attributes),
        ...Object.keys(reviewAtom.attributes),
      ]);
      return [...keys]
        .filter(
          (key) =>
            targetMarks.has(`${id}/${key}`) &&
            canonicalJson(valueState(originAtom.attributes, key)) !==
              canonicalJson(valueState(reviewAtom.attributes, key)),
        )
        .map((key) => ({
          atomId: id,
          key,
          origin: valueState(originAtom.attributes, key),
          review: valueState(reviewAtom.attributes, key),
        }));
    });
  return { kind: "text", nodeId, addedAtomIds, deletedAtomIds, markChanges };
}

function lifecycleVisible(identity: string, mutationKind: string, projection: Projection): boolean {
  return mutationKind.startsWith("node-") || mutationKind === "template-node-detach"
    ? projection.nodes[identity] !== undefined
    : projection.occurrences[identity] !== undefined;
}
