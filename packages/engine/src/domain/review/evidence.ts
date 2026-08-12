import {
  canonicalJson,
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type JsonValue,
  type PreviousValue,
} from "../fact/index.js";
import {
  valueKeyAddress,
  valueOwnerAddress,
  type Projection,
  type ProjectionGeneration,
} from "../reconcile/index.js";
import { deriveActivation, supportClosure } from "../reconcile/support.js";
import { associatedImpacts, mutationAnchor, structureEffect } from "./impacts.js";
import type { DecisionEffect, DecisionEvidence, TextDecisionEffect } from "./types.js";
import { fieldMaterializationEffect, schemaRelationEffect } from "./schema-review.js";

export function evidenceForTargets(
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  targetIds: readonly string[],
  context = createReviewEvidenceContext(snapshot),
): DecisionEvidence | null {
  const pending = context.pending;
  const targets = targetIds
    .map((id) => pending.get(id))
    .filter((fact): fact is ContributionFact => fact !== undefined)
    .sort(compareFacts);
  if (targets.length !== targetIds.length) {
    return null;
  }
  const closure = supportClosure(
    targets.map((fact) => fact.id),
    context.supportByContribution,
  ).filter((id) => pending.has(id));
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
      mutation.kind === "occurrence-move"
    ) {
      const effect = structureEffect(mutation.occurrenceId, generation, mutationAnchor(mutation));
      if (
        canonicalJson([effect.originPresent, effect.originParentId, effect.originRelation]) !==
        canonicalJson([effect.reviewPresent, effect.reviewParentId, effect.reviewRelation])
      ) {
        effects.set(`structure/${mutation.occurrenceId}`, effect);
      }
    } else if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      const effect = valueEffect(mutation, generation);
      if (canonicalJson(effect.origin) !== canonicalJson(effect.review)) {
        effects.set(`value/${valueAddress(mutation)}`, effect);
      }
    } else if (mutation.kind.startsWith("schema-")) {
      const effect = schemaRelationEffect(fact, generation);
      if (effect.originIndex !== effect.reviewIndex) {
        effects.set(
          canonicalJson(["schema-relation", effect.relation, effect.ownerId, effect.targetId]),
          effect,
        );
      }
    } else if (mutation.kind === "field-materialize" || mutation.kind === "field-initialize") {
      const effect = fieldMaterializationEffect(fact, generation);
      if (effect.originFieldNodeId !== effect.reviewFieldNodeId) {
        effects.set(
          canonicalJson(["field-materialization", effect.ownerNodeId, effect.fieldDefinitionId]),
          effect,
        );
      }
    } else if (mutation.kind === "canonical-occurrence-set") {
      const origin = generation.origin.canonicalOccurrences[mutation.nodeId] ?? null;
      const review = generation.review.canonicalOccurrences[mutation.nodeId] ?? null;
      if (origin !== review) {
        effects.set(`canonical/${mutation.nodeId}`, {
          kind: "canonical",
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

export function valueAddress(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "value-set" | "value-unset" }>,
): string {
  return valueKeyAddress(mutation.owner, mutation.namespace, mutation.key);
}

export function mutationIdentity(fact: ContributionFact): string {
  const mutation = fact.body.mutation;
  if ("nodeId" in mutation) {
    return mutation.nodeId;
  }
  if ("occurrenceId" in mutation) {
    return mutation.occurrenceId;
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

function valueEffect(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "value-set" | "value-unset" }>,
  generation: ProjectionGeneration,
) {
  return {
    kind: "value" as const,
    ownerKind: mutation.owner.kind,
    ownerId: mutation.owner.id,
    namespace: mutation.namespace,
    key: mutation.key,
    origin: projectedValue(generation.origin, mutation),
    review: projectedValue(generation.review, mutation),
  };
}

function projectedValue(
  projection: Projection,
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "value-set" | "value-unset" }>,
): PreviousValue {
  if (mutation.owner.kind === "node") {
    const owner = projection.nodes[mutation.owner.id];
    return valueState(
      mutation.namespace === "metadata" ? owner?.metadata : owner?.properties,
      mutation.key,
    );
  }
  if (mutation.owner.kind === "occurrence") {
    const owner = projection.occurrences[mutation.owner.id];
    return valueState(
      mutation.namespace === "metadata" ? owner?.metadata : owner?.properties,
      mutation.key,
    );
  }
  const address = valueOwnerAddress(mutation.owner, mutation.namespace);
  return valueState(projection.addressedValues[address], mutation.key);
}

function valueState(
  values: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): PreviousValue {
  return values && Object.hasOwn(values, key)
    ? { kind: "set", value: values[key] ?? null }
    : { kind: "unset" };
}

function lifecycleVisible(identity: string, mutationKind: string, projection: Projection): boolean {
  return mutationKind.startsWith("node-")
    ? projection.nodes[identity] !== undefined
    : projection.occurrences[identity] !== undefined;
}
