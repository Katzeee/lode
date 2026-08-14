import { compareFacts, templateInstanceNodeId, type ContributionFact } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { nodeCreationPlacements } from "./node-creation-placement.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { HunkCandidate, ReviewEffectEntry, ReviewFamilyRule } from "./review-family.js";
import { addDefinitionLifecycleImpacts } from "./schema-definition-impact.js";
import {
  isStructuralOccurrenceMutation,
  mutationAnchor,
  occurrenceIdsForNode,
  structuralOccurrenceId,
  structureEffect,
  structureEffectChanged,
} from "./structure-effect.js";

const LIFECYCLE_MUTATION_KINDS = [
  "node-create",
  "node-delete",
  "node-restore",
  "node-owner-set",
  "node-type-declare",
  "template-node-detach",
] as const;

export const lifecycleReviewFamily = {
  key: "lifecycle",
  mutationKinds: LIFECYCLE_MUTATION_KINDS,
  candidates: ({ generation, pending }) => lifecycleCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isLifecycleReviewMutation(mutation)) {
      throw new Error("Lifecycle Review family received another Mutation family");
    }
    return lifecycleEffect(fact, generation);
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (!isLifecycleReviewMutation(mutation)) {
        continue;
      }
      if ("nodeId" in mutation) {
        addNodeReviewImpacts(impacts, mutation.nodeId, generation);
        if (mutation.kind === "node-delete" || mutation.kind === "node-restore") {
          addDefinitionLifecycleImpacts(impacts, mutation.nodeId, generation);
        }
      }
      if (mutation.kind === "template-node-detach") {
        impacts.add(mutation.ownerNodeId);
        impacts.add(mutation.templateNodeId);
        for (const instance of templateInstances(generation)) {
          if (
            instance.ownerNodeId === mutation.ownerNodeId &&
            instance.templateNodeId === mutation.templateNodeId
          ) {
            impacts.add(instance.instanceOccurrenceId);
            if (instance.instanceNodeId !== null) {
              impacts.add(instance.instanceNodeId);
            }
          }
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function lifecycleCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isLifecycleReviewMutation(mutation)) {
      continue;
    }
    if (
      mutation.kind === "node-type-declare" &&
      mutation.nodeType === "field" &&
      isBoundFieldNode(generation, mutation.nodeId)
    ) {
      continue;
    }
    const key =
      mutation.kind === "node-owner-set"
        ? `owner/${mutation.nodeId}`
        : `lifecycle/${"nodeId" in mutation ? mutation.nodeId : fact.id}`;
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  attachCreationPlacements(groups, pending);
  return [...groups.values()].flatMap((facts) => candidatesForGroup(facts, generation));
}

function candidatesForGroup(
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  if (!candidateHasEffect(facts, generation)) {
    return [];
  }
  const ordered = [...facts].sort(compareFacts);
  const fact = ordered.at(-1);
  if (!fact) {
    return [];
  }
  const mutation = fact.body.mutation;
  const nodeImpacts =
    "nodeId" in mutation
      ? occurrenceIdsForNode(generation, mutation.nodeId)
      : mutation.kind === "template-node-detach"
        ? templateInstances(generation)
            .filter(
              (instance) =>
                instance.ownerNodeId === mutation.ownerNodeId &&
                instance.templateNodeId === mutation.templateNodeId,
            )
            .map((instance) => instance.instanceOccurrenceId)
        : [];
  const identities = nodeImpacts.length > 0 ? nodeImpacts : [mutationIdentity(fact)];
  return identities.map((identity) => ({
    diffSpace: {
      kind: mutation.kind === "node-owner-set" ? ("owner" as const) : ("lifecycle" as const),
      identity,
    },
    targets: ordered.map((target) => target.id),
    bridges: [],
  }));
}

function lifecycleEffect(
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
): ReviewEffectEntry | null {
  const mutation = fact.body.mutation;
  if (!isLifecycleReviewMutation(mutation)) {
    return null;
  }
  if (mutation.kind === "node-owner-set") {
    const origin = generation.origin.nodeOwners[mutation.nodeId] ?? null;
    const review = generation.review.nodeOwners[mutation.nodeId] ?? null;
    return origin === review
      ? null
      : {
          identity: `owner/${mutation.nodeId}`,
          effect: { kind: "owner", identity: mutation.nodeId, origin, review },
        };
  }
  if (mutation.kind === "node-type-declare") {
    const origin =
      generation.origin.nodeStatuses[mutation.nodeId]?.nodeType === mutation.nodeType
        ? mutation.nodeType
        : null;
    const review =
      generation.review.nodeStatuses[mutation.nodeId]?.nodeType === mutation.nodeType
        ? mutation.nodeType
        : null;
    return origin === review
      ? null
      : {
          identity: `nodeType/${mutation.nodeId}/${mutation.nodeType}`,
          effect: { kind: "lifecycle", identity: mutation.nodeId, origin, review },
        };
  }
  const identity = mutationIdentity(fact);
  const origin = generation.origin.nodes[identity] !== undefined;
  const review = generation.review.nodes[identity] !== undefined;
  return origin === review
    ? null
    : {
        identity: `lifecycle/${identity}`,
        effect: { kind: "lifecycle", identity, origin, review },
      };
}

function candidateHasEffect(
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): boolean {
  return facts.some((fact) => {
    if (lifecycleEffect(fact, generation) !== null) {
      return true;
    }
    const mutation = fact.body.mutation;
    return (
      isStructuralOccurrenceMutation(mutation) &&
      structureEffectChanged(
        structureEffect(structuralOccurrenceId(mutation), generation, mutationAnchor(mutation)),
      )
    );
  });
}

function attachCreationPlacements(
  groups: Map<string, ContributionFact[]>,
  pending: ReadonlyMap<string, ContributionFact>,
): void {
  const placements = nodeCreationPlacements(pending);
  for (const facts of groups.values()) {
    const creation = facts.find((fact) => fact.body.mutation.kind === "node-create");
    if (creation?.body.mutation.kind !== "node-create") {
      continue;
    }
    const placement = placements.get(creation.body.mutation.nodeId);
    const placementFact = placement ? pending.get(placement) : undefined;
    if (placementFact) {
      facts.push(placementFact);
    }
  }
}

function isBoundFieldNode(generation: ScopedProjectionGeneration, nodeId: string): boolean {
  return [generation.origin, generation.review].some(
    (projection) =>
      Object.values(projection.materializedFields).some((fields) =>
        fields.some((field) => field.fieldNodeId === nodeId),
      ) ||
      Object.values(projection.templateFields).some((fields) =>
        fields.some((field) => field.fieldNodeId === nodeId),
      ),
  );
}

function mutationIdentity(fact: ContributionFact): string {
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

function templateInstances(generation: ScopedProjectionGeneration) {
  return [...generation.origin.templateNodeInstances, ...generation.review.templateNodeInstances];
}

function isLifecycleReviewMutation(
  mutation: ContributionFact["body"]["mutation"],
): mutation is Extract<
  ContributionFact["body"]["mutation"],
  {
    kind:
      | "node-create"
      | "node-delete"
      | "node-restore"
      | "node-owner-set"
      | "node-type-declare"
      | "template-node-detach";
  }
> {
  return LIFECYCLE_MUTATION_KINDS.includes(
    mutation.kind as (typeof LIFECYCLE_MUTATION_KINDS)[number],
  );
}
