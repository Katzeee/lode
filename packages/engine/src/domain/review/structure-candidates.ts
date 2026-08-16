import type { ContributionFact, FactSnapshot } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { pendingProposalFacts } from "../activation/index.js";
import type { HunkCandidate } from "./review-family.js";
import { childSequenceParent } from "./structure-space.js";

export function mergeLocalStructureCandidates(
  candidates: readonly HunkCandidate[],
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const result: HunkCandidate[] = [];
  const bySpace = new Map<string, HunkCandidate>();
  const pending = pendingProposalFacts(snapshot);
  const affectedBySpace = affectedOccurrences(candidates, pending);
  for (const candidate of candidates) {
    if (candidate.diffSpace.kind !== "child-sequence") {
      result.push(candidate);
      continue;
    }
    const space = `${candidate.diffSpace.kind}/${candidate.diffSpace.identity}`;
    const region = structureRegion(candidate, pending, affectedBySpace.get(space) ?? new Set(), generation);
    const key = `${space}/${region}`;
    const existing = bySpace.get(key);
    bySpace.set(
      key,
      existing
        ? {
            ...existing,
            targets: [...new Set([...existing.targets, ...candidate.targets])],
          }
        : candidate,
    );
  }
  return [...result, ...bySpace.values()];
}

function affectedOccurrences(
  candidates: readonly HunkCandidate[],
  pending: ReadonlyMap<string, ContributionFact>,
): ReadonlyMap<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.diffSpace.kind !== "child-sequence") {
      continue;
    }
    const key = `${candidate.diffSpace.kind}/${candidate.diffSpace.identity}`;
    const affected = result.get(key) ?? new Set<string>();
    for (const target of candidate.targets) {
      const mutation = pending.get(target)?.body.mutation;
      if (mutation && "occurrenceId" in mutation) {
        affected.add(mutation.occurrenceId);
      }
    }
    result.set(key, affected);
  }
  return result;
}

function structureRegion(
  candidate: HunkCandidate,
  pending: ReadonlyMap<string, ContributionFact>,
  affected: ReadonlySet<string>,
  generation: ScopedProjectionGeneration,
): number {
  const parent = childSequenceParent(candidate.diffSpace.identity);
  const origin = generation.origin.childOccurrences[parent] ?? [];
  const review = generation.review.childOccurrences[parent] ?? [];
  const stable = new Set(origin.filter((id) => review.includes(id) && !affected.has(id)));
  const occurrenceId = targetOccurrence(candidate, pending);
  if (!occurrenceId) {
    return 0;
  }
  const positions = [origin, review]
    .filter((sequence) => sequence.includes(occurrenceId))
    .map((sequence) => sequence.slice(0, sequence.indexOf(occurrenceId)).filter((id) => stable.has(id)).length);
  return Math.min(...positions);
}

function targetOccurrence(candidate: HunkCandidate, pending: ReadonlyMap<string, ContributionFact>): string | null {
  for (const target of candidate.targets) {
    const mutation = pending.get(target)?.body.mutation;
    if (mutation && "occurrenceId" in mutation) {
      return mutation.occurrenceId;
    }
  }
  return null;
}
