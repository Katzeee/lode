import { compareFacts, type ContributionFact } from "../fact/index.js";
import type { ProjectionGeneration } from "../reconcile/index.js";
import { mutationIdentity, normalizedEffects, valueAddress } from "./evidence.js";
import { mutationAnchor, occurrenceIdsForNode, structureEffect } from "./impacts.js";
import { childSequenceIdentity } from "./structure-space.js";
import type { HunkCandidate } from "./candidates.js";
import { schemaCandidates } from "./schema-candidates.js";
import { materializedFieldCandidates } from "./schema-review.js";

export function nonTextCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  return [
    ...structureCandidates(generation, pending),
    ...valueCandidates(generation, pending),
    ...lifecycleCandidates(generation, pending),
    ...schemaCandidates(generation, pending),
    ...materializedFieldCandidates(generation, pending),
  ];
}

function structureCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const grouped = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    if (
      ![
        "occurrence-create",
        "occurrence-delete",
        "occurrence-restore",
        "occurrence-move",
        "field-value-delete",
      ].includes(fact.body.mutation.kind)
    ) {
      continue;
    }
    const mutation = fact.body.mutation;
    const occurrenceId =
      "occurrenceId" in mutation
        ? mutation.occurrenceId
        : mutation.kind === "field-value-delete"
          ? mutation.valueOccurrenceId
          : fact.id;
    const group = grouped.get(occurrenceId) ?? [];
    group.push(fact);
    grouped.set(occurrenceId, group);
  }
  return [...grouped.entries()]
    .filter(([, facts]) => normalizedEffects(facts, generation).length > 0)
    .flatMap(([occurrenceId, facts]) => {
      const ordered = [...facts].sort(compareFacts);
      const mutation = ordered.at(-1)!.body.mutation;
      const effect = structureEffect(occurrenceId, generation, mutationAnchor(mutation));
      if (
        effect.originPresent &&
        effect.reviewPresent &&
        effect.originParentId !== effect.reviewParentId
      ) {
        return [...new Set([effect.originParentId, effect.reviewParentId])].map((parentId) => ({
          diffSpace: { kind: "child-sequence" as const, identity: childSequenceIdentity(parentId) },
          targets: ordered.map((fact) => fact.id),
          bridges: [],
        }));
      }
      const parentId = !effect.originPresent ? effect.reviewParentId : effect.originParentId;
      return [
        {
          diffSpace: { kind: "child-sequence" as const, identity: childSequenceIdentity(parentId) },
          targets: ordered.map((fact) => fact.id),
          bridges: [],
        },
      ];
    });
}

function valueCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      const address = valueAddress(mutation);
      const group = groups.get(address) ?? [];
      group.push(fact);
      groups.set(address, group);
    }
  }
  return [...groups.entries()]
    .filter(([, facts]) => normalizedEffects(facts, generation).length > 0)
    .map(([address, facts]) => ({
      diffSpace: { kind: "value" as const, identity: address },
      targets: [...facts].sort(compareFacts).map((fact) => fact.id),
      bridges: [],
    }));
}

function lifecycleCandidates(
  generation: ProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    if (
      ![
        "node-create",
        "node-delete",
        "node-restore",
        "canonical-occurrence-set",
        "template-node-detach",
      ].includes(fact.body.mutation.kind)
    ) {
      continue;
    }
    const mutation = fact.body.mutation;
    const key =
      mutation.kind === "canonical-occurrence-set"
        ? `canonical/${mutation.nodeId}`
        : `lifecycle/${"nodeId" in mutation ? mutation.nodeId : fact.id}`;
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((facts) => normalizedEffects(facts, generation).length > 0)
    .flatMap((facts) => {
      const ordered = [...facts].sort(compareFacts);
      const fact = ordered.at(-1)!;
      const mutation = fact.body.mutation;
      const nodeImpacts =
        "nodeId" in mutation
          ? occurrenceIdsForNode(generation, mutation.nodeId)
          : mutation.kind === "template-node-detach"
            ? [
                ...generation.origin.templateNodeInstances,
                ...generation.review.templateNodeInstances,
              ]
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
          kind:
            mutation.kind === "canonical-occurrence-set"
              ? ("canonical" as const)
              : ("lifecycle" as const),
          identity,
        },
        targets: ordered.map((target) => target.id),
        bridges: [],
      }));
    });
}
