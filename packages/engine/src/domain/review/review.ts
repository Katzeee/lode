import {
  canonicalDigest,
  frontierEquals,
  owningFactIds,
  stableStringCompare,
  type FactAction,
  type FactSnapshot,
  type ResolutionDecision,
} from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { collectReviewCandidates } from "./review-plan.js";
import { createReviewEvidenceContext, evidenceForTargets, type ReviewEvidenceContext } from "./evidence.js";
import type { DecisionEvidence, ReviewHunk, ReviewQuery, ReviewSelection, SelectionValidation } from "./types.js";

export function queryReview(
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  page?: Readonly<{
    pending: ReadonlyMap<FactAction["id"], FactAction>;
    context?: ReviewEvidenceContext;
    next: string | null;
  }>,
): ReviewQuery {
  assertGeneration(snapshot, generation);
  const context = page?.context ?? createReviewEvidenceContext(snapshot);
  const pending = page?.pending ?? context.pending;
  const evidenceCache = new Map<string, DecisionEvidence>();
  const hunks = collectReviewCandidates(snapshot, generation, pending).map((candidate) =>
    candidateToHunk(snapshot, generation, candidate, context, evidenceCache),
  );
  return {
    generationId: generation.identity.generationId,
    frontier: generation.identity.frontier,
    hunks: linkAssociatedHunks(hunks),
    next: page?.next ?? null,
  };
}

export function validateReviewSelection(
  selection: ReviewSelection,
  decision: ResolutionDecision,
  actorId: string,
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
): SelectionValidation {
  const current = evidenceForTargets(
    snapshot,
    generation,
    selection.proposalActionIds,
    createReviewEvidenceContext(snapshot),
  );
  if (!current || evidenceId(current) !== selection.evidenceId) {
    return stale(generation, "decision evidence changed");
  }
  return {
    kind: "valid",
    resolution: {
      kind: "resolution",
      adjudicatesResolutionIds: [],
      actorId,
      decision,
      proposalFactIds: owningFactIds(snapshot.facts, current.proposalActionIds),
    },
  };
}

function candidateToHunk(
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  candidate: HunkCandidate,
  context: ReviewEvidenceContext,
  cache: Map<string, DecisionEvidence>,
): ReviewHunk {
  const cacheKey = [...candidate.targets].sort(stableStringCompare).join("\u0000");
  const evidence = cache.get(cacheKey) ?? evidenceForTargets(snapshot, generation, candidate.targets, context);
  if (!evidence) {
    throw new Error("Review candidate has no decision evidence");
  }
  const completeEvidence = cache.get(cacheKey) ?? evidence;
  cache.set(cacheKey, completeEvidence);
  return {
    id: canonicalDigest({ diffSpace: candidate.diffSpace, evidence: completeEvidence }),
    diffSpace: candidate.diffSpace,
    neutralBridgeAtomIds: candidate.bridges,
    linkedHunkIds: [],
    evidence: {
      effects: completeEvidence.effects,
      associatedImpactIds: completeEvidence.associatedImpactIds,
    },
    selection: {
      evidenceId: evidenceId(completeEvidence),
      proposalActionIds: completeEvidence.proposalActionIds,
    },
  };
}

function evidenceId(evidence: DecisionEvidence): string {
  return canonicalDigest(evidence);
}

function linkAssociatedHunks(hunks: readonly ReviewHunk[]): readonly ReviewHunk[] {
  const groups = new Map<string, ReviewHunk[]>();
  for (const hunk of hunks) {
    const signature = hunk.evidence.associatedImpactIds.join("\u0000");
    const group = groups.get(signature) ?? [];
    group.push(hunk);
    groups.set(signature, group);
  }
  const linkedById = new Map(hunks.map((hunk) => [hunk.id, new Set<string>()]));
  const signaturesByImpact = new Map<string, Set<string>>();
  for (const [signature, group] of groups) {
    const groupIds = group.map((hunk) => hunk.id);
    for (const hunk of group) {
      const linked = linkedById.get(hunk.id)!;
      groupIds.forEach((id) => {
        if (id !== hunk.id) {
          linked.add(id);
        }
      });
    }
    for (const impact of group[0]?.evidence.associatedImpactIds ?? []) {
      const signatures = signaturesByImpact.get(impact) ?? new Set<string>();
      signatures.add(signature);
      signaturesByImpact.set(impact, signatures);
    }
  }
  for (const signatures of signaturesByImpact.values()) {
    if (signatures.size < 2) {
      continue;
    }
    const related = [...signatures].flatMap((signature) => groups.get(signature) ?? []);
    for (const hunk of related) {
      const linked = linkedById.get(hunk.id)!;
      related.forEach((candidate) => {
        if (candidate.id !== hunk.id) {
          linked.add(candidate.id);
        }
      });
    }
  }
  return hunks.map((hunk) => ({
    ...hunk,
    linkedHunkIds: [...linkedById.get(hunk.id)!].sort(stableStringCompare),
  }));
}

function assertGeneration(snapshot: FactSnapshot, generation: ScopedProjectionGeneration): void {
  if (!frontierEquals(generation.identity.frontier, snapshot.frontier)) {
    throw new Error("Review query requires the complete generation at the FactSnapshot frontier");
  }
}

function stale(generation: ScopedProjectionGeneration, reason: string): SelectionValidation {
  return { kind: "stale", currentGenerationId: generation.identity.generationId, reason };
}
