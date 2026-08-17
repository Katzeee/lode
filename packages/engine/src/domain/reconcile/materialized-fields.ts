import {
  compareFacts,
  fieldDefinitionEndpointOccurrenceId,
  stableStringCompare,
  type ContributionFact,
} from "../fact/index.js";
import type { MaterializedField } from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { appendUnique, materializedFieldRecord } from "./supertag-relation-records.js";
import { projectTuple } from "./tuple.js";

export function projectMaterializedFields(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  const candidates = collectCandidates(
    active,
    existingNodeIds,
    fieldDefinitionIds,
    occurrences,
    childOccurrences,
    nodeOwners,
  );
  const byOwner = new Map<string, MaterializedField[]>();
  const claimedNodes = new Set<string>();
  const claimedOccurrences = new Set<string>();
  for (const ownerCandidates of [...candidates.values()].sort((left, right) =>
    compareCandidateGroups(left, right, occurrences, childOccurrences),
  )) {
    const available = ownerCandidates
      .sort((left, right) => compareFacts(left.fact, right.fact))
      .filter(
        (candidate) => !claimedNodes.has(candidate.fieldNodeId) && !claimedOccurrences.has(candidate.fieldOccurrenceId),
      );
    const canonical = available[0];
    if (!canonical) {
      continue;
    }
    const valueOccurrenceIds: string[] = [];
    for (const candidate of available) {
      claimedNodes.add(candidate.fieldNodeId);
      claimedOccurrences.add(candidate.fieldOccurrenceId);
      for (const occurrenceId of (childOccurrences.get(candidate.fieldNodeId) ?? []).slice(1)) {
        appendUnique(valueOccurrenceIds, occurrenceId);
      }
    }
    const ownerFields = byOwner.get(canonical.ownerNodeId) ?? [];
    ownerFields.push({
      ownerNodeId: canonical.ownerNodeId,
      fieldDefinitionId: canonical.fieldDefinitionId,
      fieldNodeId: canonical.fieldNodeId,
      fieldOccurrenceId: canonical.fieldOccurrenceId,
      definitionOccurrenceId: fieldDefinitionEndpointOccurrenceId(canonical.fieldOccurrenceId),
      valueOccurrenceIds,
    });
    byOwner.set(canonical.ownerNodeId, ownerFields);
  }
  return materializedFieldRecord(byOwner);
}

function collectCandidates(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  fieldDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): ReadonlyMap<string, MaterializationCandidate[]> {
  const candidates = new Map<string, MaterializationCandidate[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "field-materialize") {
      continue;
    }
    const occurrence = occurrences.get(mutation.fieldOccurrenceId);
    const tuple = projectTuple(mutation.fieldNodeId, occurrences, childOccurrences, nodeOwners);
    const definitionEndpoint = tuple.endpoints[0];
    if (
      !existingNodeIds.has(mutation.ownerNodeId) ||
      !existingNodeIds.has(mutation.fieldNodeId) ||
      !fieldDefinitionIds.has(mutation.fieldDefinitionId) ||
      occurrence?.nodeId !== mutation.fieldNodeId ||
      occurrence.parentNodeId !== mutation.ownerNodeId ||
      tuple.ownerNodeId !== mutation.ownerNodeId ||
      definitionEndpoint?.occurrenceId !== fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId) ||
      definitionEndpoint.nodeId !== mutation.fieldDefinitionId ||
      nodeOwners[mutation.fieldDefinitionId] === mutation.fieldNodeId
    ) {
      continue;
    }
    const key = `${encodeURIComponent(mutation.ownerNodeId)}/${encodeURIComponent(mutation.fieldDefinitionId)}`;
    const values = candidates.get(key) ?? [];
    values.push({ fact, ...mutation });
    candidates.set(key, values);
  }
  return candidates;
}

type MaterializationCandidate = Readonly<{
  fact: ContributionFact;
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
}>;

function compareCandidateGroups(
  left: readonly MaterializationCandidate[],
  right: readonly MaterializationCandidate[],
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): number {
  const leftCandidate = left[0];
  const rightCandidate = right[0];
  if (!leftCandidate || !rightCandidate) {
    return left.length - right.length;
  }
  const leftParent = occurrences.get(leftCandidate.fieldOccurrenceId)?.parentNodeId ?? null;
  const rightParent = occurrences.get(rightCandidate.fieldOccurrenceId)?.parentNodeId ?? null;
  const sharedParent = leftParent === rightParent ? leftParent : null;
  const placementOrder =
    sharedParent !== null
      ? (childOccurrences.get(sharedParent)?.indexOf(leftCandidate.fieldOccurrenceId) ?? -1) -
        (childOccurrences.get(sharedParent)?.indexOf(rightCandidate.fieldOccurrenceId) ?? -1)
      : 0;
  return (
    placementOrder ||
    stableStringCompare(leftCandidate.ownerNodeId, rightCandidate.ownerNodeId) ||
    stableStringCompare(leftCandidate.fieldDefinitionId, rightCandidate.fieldDefinitionId)
  );
}
