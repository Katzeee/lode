import type { FactAction, FactSnapshot } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import { pendingProposalActions } from "../activation/index.js";
import type { HunkCandidate } from "./review-family.js";
import { childSequenceParent } from "./structure-space.js";

export function mergeLocalStructureCandidates(
  candidates: readonly HunkCandidate[],
  snapshot: FactSnapshot,
  generation: InterpretedProjectionGeneration,
): readonly HunkCandidate[] {
  const result: HunkCandidate[] = [];
  const bySpace = new Map<string, HunkCandidate>();
  const pending = pendingProposalActions(snapshot);
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
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): ReadonlyMap<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.diffSpace.kind !== "child-sequence") {
      continue;
    }
    const key = `${candidate.diffSpace.kind}/${candidate.diffSpace.identity}`;
    const affected = result.get(key) ?? new Set<string>();
    for (const target of candidate.targets) {
      const action = pending.get(target)?.action;
      if (action && "placementId" in action) {
        affected.add(action.placementId);
      }
    }
    result.set(key, affected);
  }
  return result;
}

function structureRegion(
  candidate: HunkCandidate,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
  affected: ReadonlySet<string>,
  generation: InterpretedProjectionGeneration,
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

function targetOccurrence(candidate: HunkCandidate, pending: ReadonlyMap<FactAction["id"], FactAction>): string | null {
  for (const target of candidate.targets) {
    const action = pending.get(target)?.action;
    if (action && "placementId" in action) {
      return action.placementId;
    }
  }
  return null;
}
